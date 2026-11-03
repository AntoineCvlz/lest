"""Écritures du domaine `nutrition` (ADR 0009) : import de la table Ciqual."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import uuid4

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.nutrition.ciqual import CiqualFood
from apps.nutrition.models import Food, FoodSource

IMPORT_LOCK = "nutrition:ciqual-import"
# Un import complet prend quelques secondes ; l'expiration ne sert que si le processus meurt.
IMPORT_LOCK_SECONDS = 60 * 60


class ImportRunningError(Exception):
    """Un import de Ciqual est déjà en cours."""


class EmptyTableError(Exception):
    """Ciqual n'a donné aucun aliment exploitable : rien n'est modifié (sinon toute la table
    serait désactivée sur une réponse vide)."""


@contextmanager
def import_lock() -> Iterator[None]:
    """Exécute l'import seul, ou lève `ImportRunningError`. Le verrou n'est rendu que par celui
    qui le détient (jeton), même s'il a expiré entre-temps."""
    token = uuid4().hex
    if not cache.add(IMPORT_LOCK, token, IMPORT_LOCK_SECONDS):
        raise ImportRunningError
    try:
        yield
    finally:
        if cache.get(IMPORT_LOCK) == token:
            cache.delete(IMPORT_LOCK)


@dataclass(frozen=True)
class ImportReport:
    created: int
    updated: int
    deactivated: int


def import_foods(*, foods: list[CiqualFood]) -> ImportReport:
    """Crée ou met à jour les aliments Ciqual (clé : code Ciqual), et désactive ceux qui ont
    quitté la table (ils restent lisibles depuis le journal). Rejouable, en une transaction.

    Lève `EmptyTableError` sans rien modifier si `foods` est vide.
    """
    if not foods:
        raise EmptyTableError
    now = timezone.now()
    with transaction.atomic():
        existing = {
            food.source_code: food for food in Food.objects.filter(source=FoodSource.CIQUAL)
        }
        created: list[Food] = []
        updated: list[Food] = []
        for item in foods:
            food = existing.get(item.code)
            if food is None:
                food = Food(source=FoodSource.CIQUAL, source_code=item.code)
                created.append(food)
            else:
                updated.append(food)
            food.name = item.name
            food.kcal_100g = item.kcal
            food.protein_100g = item.protein
            food.carbs_100g = item.carbs
            food.fat_100g = item.fat
            food.is_active = True
            food.fetched_at = now
        Food.objects.bulk_create(created, batch_size=500)
        Food.objects.bulk_update(
            updated,
            [
                "name",
                "kcal_100g",
                "protein_100g",
                "carbs_100g",
                "fat_100g",
                "is_active",
                "fetched_at",
            ],
            batch_size=500,
        )
        codes = {item.code for item in foods}
        deactivated = (
            Food.objects.filter(source=FoodSource.CIQUAL, is_active=True)
            .exclude(source_code__in=codes)
            .update(is_active=False)
        )
    return ImportReport(created=len(created), updated=len(updated), deactivated=deactivated)
