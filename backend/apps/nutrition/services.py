"""Écritures du domaine `nutrition` (ADR 0009) : import de la table Ciqual, produits Open Food
Facts gardés au scan, aliments perso (`PUT`/`DELETE` idempotents sous l'UUID du client)."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.services import lock_account
from apps.nutrition import openfoodfacts
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


# --- Open Food Facts : un appel par scan, partagé par tous les comptes (ADR 0009) -----------

# Sous les 15 lectures par minute et par IP d'OFF : le serveur de Lest est une seule IP.
OFF_CALLS_PER_MINUTE = 12
# Un produit gardé reste servi tel quel 30 jours ; une absence, 1 jour.
OFF_FRESH = timedelta(days=30)
OFF_MISSING_SECONDS = 24 * 60 * 60


class BarcodeNotFoundError(Exception):
    """Code-barres invalide, ou produit inconnu d'Open Food Facts."""


class BarcodeUnusableError(Exception):
    """Produit connu d'OFF mais sans valeurs exploitables : à saisir en aliment perso."""


class OffBusyError(Exception):
    """Plafond d'appels à OFF atteint, ou OFF injoignable sans copie locale : réessayer."""


def _consume_off_call() -> bool:
    """Compte un appel dans la minute en cours ; `False` au-delà du plafond."""
    bucket = f"nutrition:off-calls:{timezone.now():%Y%m%d%H%M}"
    cache.add(bucket, 0, timeout=120)
    return cache.incr(bucket) <= OFF_CALLS_PER_MINUTE


def lookup_barcode(
    *, code: str, fetch: Callable[[str], openfoodfacts.OffProduct | None] | None = None
) -> Food:
    """Aliment du code-barres `code` : copie locale récente, sinon lu chez OFF et gardé.

    Lève `BarcodeNotFoundError`, `BarcodeUnusableError` ou `OffBusyError`. Si OFF est
    injoignable, une copie locale ancienne est servie plutôt qu'une erreur.
    """
    if not openfoodfacts.valid_barcode(code):
        raise BarcodeNotFoundError
    known = Food.objects.filter(source=FoodSource.OFF, source_code=code, owner__isnull=True).first()
    now = timezone.now()
    if known is not None and known.fetched_at and now - known.fetched_at < OFF_FRESH:
        return known
    missing_key = f"nutrition:off-missing:{code}"
    if known is None and cache.get(missing_key):
        raise BarcodeNotFoundError
    if not _consume_off_call():
        if known is not None:
            return known
        raise OffBusyError
    reader = fetch or (
        lambda value: openfoodfacts.fetch_product(
            value, base_url=settings.OFF_BASE_URL, contact=settings.OFF_CONTACT
        )
    )
    try:
        product = reader(code)
    except openfoodfacts.OffError as error:
        if known is not None:
            return known
        raise OffBusyError from error
    except openfoodfacts.UnusableProductError as error:
        raise BarcodeUnusableError from error
    if product is None:
        cache.set(missing_key, 1, OFF_MISSING_SECONDS)
        raise BarcodeNotFoundError
    food = known or Food(source=FoodSource.OFF, source_code=code)
    food.name = product.name
    food.brand = product.brand
    food.kcal_100g = product.kcal
    food.protein_100g = product.protein
    food.carbs_100g = product.carbs
    food.fat_100g = product.fat
    food.serving_g = product.serving_g
    food.is_active = True
    food.fetched_at = now
    try:
        food.save()
    except IntegrityError:
        # Deux premiers scans simultanés : l'autre a écrit, on relit sa copie.
        return Food.objects.get(source=FoodSource.OFF, source_code=code, owner__isnull=True)
    return food


# --- Aliments perso ------------------------------------------------------------------------

MAX_CUSTOM_FOODS = 500


class NotFoundError(Exception):
    """Identifiant d'un autre compte, ou d'un aliment commun : répondu comme inconnu (404)."""


@dataclass(frozen=True)
class CustomFoodValues:
    name: str
    brand: str
    kcal_100g: Decimal
    protein_100g: Decimal | None
    carbs_100g: Decimal | None
    fat_100g: Decimal | None
    serving_g: Decimal | None


def put_custom_food(*, owner: User, food_id: UUID, values: CustomFoodValues) -> tuple[Food, bool]:
    """Crée ou remplace l'aliment perso `food_id` de `owner` ; renvoie l'aliment et `True` s'il
    est créé. Lève `NotFoundError` (aliment commun ou d'un autre compte) ou `ValidationError`
    (plafond, valeurs hors bornes)."""
    with transaction.atomic():
        # Sérialise les créations du compte : le plafond ne peut pas être dépassé à deux.
        lock_account(owner)
        existing = Food.objects.select_for_update().filter(pk=food_id).first()
        if existing is not None and existing.owner_id != owner.pk:
            raise NotFoundError
        if existing is None and Food.objects.filter(owner=owner).count() >= MAX_CUSTOM_FOODS:
            raise ValidationError({"food_id": ValidationError("Plafond atteint.", code="too_many")})
        food = existing or Food(id=food_id, source=FoodSource.CUSTOM, owner=owner)
        for field, value in vars(values).items():
            setattr(food, field, value)
        # Bornes (contraintes du modèle) vérifiées ici : un 422 plutôt qu'une erreur de base.
        food.full_clean(validate_unique=False)
        food.save(force_insert=existing is None)
    return food, existing is None


def delete_custom_food(*, owner: User, food_id: UUID) -> None:
    """Supprime l'aliment perso `food_id` de `owner` ; sans effet s'il n'existe pas, est commun
    ou appartient à un autre compte (idempotent)."""
    Food.objects.filter(pk=food_id, owner=owner, source=FoodSource.CUSTOM).delete()
