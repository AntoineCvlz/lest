"""Lectures du domaine `nutrition` (ADR 0009). Un aliment perso n'est visible que de son
propriétaire ; Ciqual et Open Food Facts le sont de tous."""

from typing import Any
from uuid import UUID

from django.db.models import Case, IntegerField, Q, QuerySet, Value, When

from apps.accounts.models import User
from apps.nutrition.models import Food

MAX_RESULTS = 30
MAX_SEARCH_TERMS = 5


def _visible(owner: User) -> QuerySet[Food]:
    return Food.objects.filter(Q(owner__isnull=True) | Q(owner=owner))


def search_foods(*, owner: User, query: str) -> list[Food]:
    """Aliments actifs dont le nom contient chaque terme (sans tenir compte des accents) :
    d'abord ceux qui commencent par le premier terme, puis les autres, par ordre alphabétique.
    `MAX_RESULTS` au plus (suggestions de saisie, ADR 0009)."""
    terms = query.split()[:MAX_SEARCH_TERMS]
    if not terms:
        return []
    foods = _visible(owner).filter(is_active=True)
    for term in terms:
        foods = foods.filter(name__unaccent__icontains=term)
    ranked = foods.annotate(
        rank=Case(
            When(name__unaccent__istartswith=terms[0], then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )
    ).order_by("rank", "name", "id")
    return list(ranked[:MAX_RESULTS])


def get_food(*, owner: User, food_id: UUID) -> Food | None:
    """Aliment visible par `owner`, même désactivé (il reste lisible depuis le journal)."""
    return _visible(owner).filter(pk=food_id).first()


def export_custom_foods(*, owner: User) -> list[dict[str, Any]]:
    """Aliments perso de `owner`, pour l'export RGPD."""

    def number(value: object) -> float | None:
        return None if value is None else float(str(value))

    return [
        {
            "name": food.name,
            "brand": food.brand,
            "kcal_100g": float(food.kcal_100g),
            "protein_100g": number(food.protein_100g),
            "carbs_100g": number(food.carbs_100g),
            "fat_100g": number(food.fat_100g),
            "serving_g": number(food.serving_g),
        }
        for food in Food.objects.filter(owner=owner)
    ]
