"""Aliments (ADR 0009) : recherche locale, fiche, scan d'un code-barres (Open Food Facts) et
aliments perso (`PUT`/`DELETE` idempotents sous l'UUID du client, ADR 0003) ; journal des
repas et eau, chiffrés (ADR 0010). Routers minces."""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from allauth.core import ratelimit
from django.http import Http404, HttpRequest
from ninja import Field, Query, Router, Schema, Status
from pydantic import UUID4, AfterValidator, StringConstraints

from apps.accounts.models import User
from apps.nutrition import selectors, services
from apps.nutrition.models import (
    MAX_ENTRY_GRAMS,
    MAX_GRAMS_100G,
    MAX_KCAL_100G,
    MAX_WATER_ML,
    Food,
)
from common.auth import request_user
from common.problems import ProblemError
from common.text import printable

router = Router(tags=["nutrition"])

RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
UNAVAILABLE_TYPE = "urn:lest:problem:service-unavailable"
UNUSABLE_TYPE = "urn:lest:problem:unusable-product"
# Écritures d'aliments perso, et scans (chacun peut coûter un appel à OFF), par compte.
WRITE_ACTION = "nutrition_write"
LOOKUP_ACTION = "food_lookup"

# Nom saisi : espaces de bord retirés, 1 à 120 caractères imprimables.
Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    AfterValidator(printable),
]
Brand = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=120), AfterValidator(printable)
]
Grams = Annotated[Decimal, Field(ge=0, le=MAX_GRAMS_100G, max_digits=4, decimal_places=1)]


class CustomFoodIn(Schema):
    name: Name
    brand: Brand = ""
    kcal_100g: Decimal = Field(ge=0, le=MAX_KCAL_100G, max_digits=4, decimal_places=1)
    protein_100g: Grams | None = None
    carbs_100g: Grams | None = None
    fat_100g: Grams | None = None
    serving_g: Decimal | None = Field(None, gt=0, le=2000, max_digits=5, decimal_places=1)


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


@router.get("/foods/recent/", response=list[FoodOut], summary="Aliments saisis récemment (journal)")
def recent_foods(request: HttpRequest) -> list[FoodOut]:
    # Déclarée avant `/foods/{food_id}/` : « recent » n'y est jamais pris pour un identifiant.
    return [_food_out(food) for food in selectors.recent_foods(owner=request_user(request))]


@router.get("/foods/{food_id}/", response=FoodOut, summary="Fiche d'un aliment")
def get_food(request: HttpRequest, food_id: UUID) -> FoodOut:
    food = selectors.get_food(owner=request_user(request), food_id=food_id)
    if food is None:
        raise Http404
    return _food_out(food)


def _limited(request: HttpRequest, action: str) -> User:
    """Compte qui agit, après sa limite de débit (429 au-delà ; GET compté aussi)."""
    user = request_user(request)
    if ratelimit.consume_or_429(request, action=action, user=user, limit_get=True) is not None:
        raise ProblemError(
            429, "Trop de demandes. Réessayez dans un instant.", type_=RATE_LIMITED_TYPE
        )
    return user


@router.get(
    "/foods/barcode/{code}/",
    response=FoodOut,
    summary="Aliment d'un code-barres (Open Food Facts)",
    description=(
        "Copie locale récente, sinon lue chez Open Food Facts (un appel par scan, ADR 0009). "
        "404 : code invalide ou produit inconnu ; 422 : produit sans valeurs exploitables ; "
        "503 : Open Food Facts saturé ou injoignable, réessayer."
    ),
)
def lookup_barcode(request: HttpRequest, code: str) -> FoodOut:
    owner = _limited(request, LOOKUP_ACTION)
    try:
        food = services.lookup_barcode(owner=owner, code=code)
    except services.BarcodeNotFoundError as error:
        raise Http404 from error
    except services.BarcodeUnusableError as error:
        raise ProblemError(
            422,
            "Produit sans valeurs nutritionnelles exploitables : créez un aliment perso.",
            type_=UNUSABLE_TYPE,
        ) from error
    except services.OffQuotaError as error:
        raise ProblemError(
            429, "Trop de produits nouveaux scannés. Réessayez plus tard.", type_=RATE_LIMITED_TYPE
        ) from error
    except services.OffBusyError as error:
        raise ProblemError(
            503,
            "Recherche du produit indisponible. Réessayez dans un instant.",
            type_=UNAVAILABLE_TYPE,
        ) from error
    return _food_out(food)


@router.put(
    "/foods/{food_id}/",
    response={200: FoodOut, 201: FoodOut},
    summary="Créer ou remplacer un aliment perso",
)
def write_custom_food(
    request: HttpRequest, food_id: UUID4, payload: CustomFoodIn
) -> Status[FoodOut]:
    owner = _limited(request, WRITE_ACTION)
    try:
        food, created = services.put_custom_food(
            owner=owner,
            food_id=food_id,
            values=services.CustomFoodValues(**payload.model_dump()),
        )
    except services.NotFoundError as error:
        raise Http404 from error
    return Status(201 if created else 200, _food_out(food))


@router.delete("/foods/{food_id}/", response={204: None}, summary="Supprimer un aliment perso")
def remove_custom_food(request: HttpRequest, food_id: UUID4) -> Status[None]:
    services.delete_custom_food(owner=_limited(request, WRITE_ACTION), food_id=food_id)
    return Status(204, None)


# --- Journal des repas et eau (ADR 0010) ----------------------------------------------------

UNKNOWN_TYPE = "urn:lest:problem:unknown-reference"
# Valeurs de `Meal` (un test vérifie qu'elles restent alignées) : énumération dans l'OpenAPI.
MealName = Literal["breakfast", "lunch", "dinner", "snack"]


class EntryIn(Schema):
    date: date
    meal: MealName
    food_id: UUID
    grams: Decimal = Field(gt=0, le=MAX_ENTRY_GRAMS, max_digits=5, decimal_places=1)


class EntryOut(Schema):
    id: UUID
    date: date
    meal: MealName
    food_id: str
    name: str
    grams: float
    kcal: float
    protein: float
    carbs: float
    fat: float


class TotalsOut(Schema):
    kcal: float
    protein: float
    carbs: float
    fat: float


class DayOut(Schema):
    date: date
    entries: list[EntryOut]
    totals: TotalsOut
    water_ml: int


class WaterIn(Schema):
    ml: int = Field(strict=True, ge=0, le=MAX_WATER_ML)


class WaterOut(Schema):
    date: date
    ml: int


def _entry_out(view: selectors.EntryView) -> EntryOut:
    return EntryOut.model_validate(
        {
            "id": view.id,
            "date": view.date,
            "meal": view.meal,
            "food_id": view.food_id,
            "name": view.name,
            "grams": float(view.grams),
            "kcal": float(view.kcal),
            "protein": float(view.protein),
            "carbs": float(view.carbs),
            "fat": float(view.fat),
        }
    )


@router.get("/journal/{day}/", response=DayOut, summary="Journal d'un jour")
def day_journal(request: HttpRequest, day: date) -> DayOut:
    journal = selectors.day_journal(owner=request_user(request), day=day)
    return DayOut(
        date=journal.date,
        entries=[_entry_out(entry) for entry in journal.entries],
        totals=TotalsOut(
            kcal=float(journal.totals.kcal),
            protein=float(journal.totals.protein),
            carbs=float(journal.totals.carbs),
            fat=float(journal.totals.fat),
        ),
        water_ml=journal.water_ml,
    )


@router.put(
    "/journal-entries/{entry_id}/",
    response={200: EntryOut, 201: EntryOut},
    summary="Ajouter ou modifier un aliment du journal",
)
def write_entry(request: HttpRequest, entry_id: UUID4, payload: EntryIn) -> Status[EntryOut]:
    owner = _limited(request, WRITE_ACTION)
    try:
        entry, created = services.put_entry(
            owner=owner,
            entry_id=entry_id,
            day=payload.date,
            meal=payload.meal,
            food_id=payload.food_id,
            grams=payload.grams,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.UnknownFoodError as error:
        raise ProblemError(422, "Aliment inconnu.", type_=UNKNOWN_TYPE) from error
    view = selectors.day_journal(owner=owner, day=entry.date)
    return Status(
        201 if created else 200,
        _entry_out(next(e for e in view.entries if e.id == entry.id)),
    )


@router.delete(
    "/journal-entries/{entry_id}/", response={204: None}, summary="Retirer un aliment du journal"
)
def remove_entry(request: HttpRequest, entry_id: UUID4) -> Status[None]:
    services.delete_entry(owner=_limited(request, WRITE_ACTION), entry_id=entry_id)
    return Status(204, None)


@router.put("/water/{day}/", response=WaterOut, summary="Fixer l'eau bue un jour")
def write_water(request: HttpRequest, day: date, payload: WaterIn) -> WaterOut:
    water = services.put_water(owner=_limited(request, WRITE_ACTION), day=day, ml=payload.ml)
    return WaterOut(date=water.date, ml=int(water.ml or 0))
