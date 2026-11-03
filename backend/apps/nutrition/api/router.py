"""Aliments (ADR 0009) : recherche locale et fiche. Routers minces."""

from typing import Annotated
from uuid import UUID

from django.http import Http404, HttpRequest
from ninja import Field, Query, Router, Schema
from pydantic import AfterValidator

from apps.nutrition import selectors
from apps.nutrition.models import Food
from common.auth import request_user
from common.text import printable

router = Router(tags=["nutrition"])


class FoodOut(Schema):
    id: UUID
    source: str
    name: str
    brand: str
    kcal_100g: float
    # `None` : inconnue dans la source.
    protein_100g: float | None
    carbs_100g: float | None
    fat_100g: float | None
    serving_g: float | None
    is_custom: bool


class FoodQuery(Schema):
    q: Annotated[str, AfterValidator(printable)] = Field(min_length=2, max_length=100)


def _food_out(food: Food) -> FoodOut:
    def number(value: object) -> float | None:
        return None if value is None else float(str(value))

    return FoodOut(
        id=food.id,
        source=food.source,
        name=food.name,
        brand=food.brand,
        kcal_100g=float(food.kcal_100g),
        protein_100g=number(food.protein_100g),
        carbs_100g=number(food.carbs_100g),
        fat_100g=number(food.fat_100g),
        serving_g=number(food.serving_g),
        is_custom=food.owner_id is not None,
    )


@router.get("/foods/", response=list[FoodOut], summary="Chercher un aliment")
def search_foods(request: HttpRequest, query: Query[FoodQuery]) -> list[FoodOut]:
    foods = selectors.search_foods(owner=request_user(request), query=query.q)
    return [_food_out(food) for food in foods]


@router.get("/foods/{food_id}/", response=FoodOut, summary="Fiche d'un aliment")
def get_food(request: HttpRequest, food_id: UUID) -> FoodOut:
    food = selectors.get_food(owner=request_user(request), food_id=food_id)
    if food is None:
        raise Http404
    return _food_out(food)
