"""Lectures du domaine `nutrition` (ADR 0009). Un aliment perso n'est visible que de son
propriétaire ; Ciqual et Open Food Facts le sont de tous."""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from django.db.models import Case, IntegerField, Q, QuerySet, Value, When
from django.utils import timezone

from apps.accounts.models import User
from apps.body.selectors import latest_weight
from apps.nutrition import targets as calc
from apps.nutrition.models import Food, JournalEntry, NutritionTarget, WaterIntake

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


# --- Journal des repas et eau (ADR 0010) : déchiffrés et calculés ici ----------------------

TENTH = Decimal("0.1")
# Lignes relues pour « aliments récents » : quelques semaines de saisie.
RECENT_SCAN = 300
MAX_RECENT = 20


@dataclass(frozen=True)
class EntryView:
    """Entrée du journal déchiffrée, valeurs calculées pour sa quantité (inconnue comptée 0)."""

    id: UUID
    date: date
    meal: str
    food_id: str
    name: str
    grams: Decimal
    kcal: Decimal
    protein: Decimal
    carbs: Decimal
    fat: Decimal


@dataclass(frozen=True)
class Totals:
    kcal: Decimal
    protein: Decimal
    carbs: Decimal
    fat: Decimal


@dataclass(frozen=True)
class DayJournal:
    date: date
    entries: list[EntryView]
    totals: Totals
    water_ml: int


def _part(per_100g: Decimal | None, grams: Decimal) -> Decimal:
    return ((per_100g or Decimal(0)) * grams / 100).quantize(TENTH, rounding=ROUND_HALF_UP)


def _view(entry: JournalEntry) -> EntryView:
    grams = entry.grams or Decimal(0)
    return EntryView(
        id=entry.id,
        date=entry.date,
        meal=entry.meal,
        food_id=entry.food_ref or "",
        name=entry.name or "",
        grams=grams,
        kcal=_part(entry.kcal_100g, grams),
        protein=_part(entry.protein_100g, grams),
        carbs=_part(entry.carbs_100g, grams),
        fat=_part(entry.fat_100g, grams),
    )


def day_journal(*, owner: User, day: date) -> DayJournal:
    """Journal de `owner` pour le jour `day` : entrées dans l'ordre de saisie, totaux, eau."""
    entries = [_view(e) for e in JournalEntry.objects.filter(owner=owner, date=day)]
    water = WaterIntake.objects.filter(owner=owner, date=day).first()
    return DayJournal(
        date=day,
        entries=entries,
        totals=Totals(
            kcal=sum((e.kcal for e in entries), Decimal(0)),
            protein=sum((e.protein for e in entries), Decimal(0)),
            carbs=sum((e.carbs for e in entries), Decimal(0)),
            fat=sum((e.fat for e in entries), Decimal(0)),
        ),
        water_ml=int(water.ml or 0) if water else 0,
    )


def recent_foods(*, owner: User) -> list[Food]:
    """Aliments saisis récemment par `owner`, du plus récent au plus ancien, sans doublon ;
    seulement ceux qui existent encore et lui sont visibles."""
    refs: list[UUID] = []
    # Seule la référence est lue (et déchiffrée) : 1 jeton par entrée au lieu de 7.
    latest = (
        JournalEntry.objects.filter(owner=owner)
        .order_by("-date", "-created_at")
        .only("food_ref")[:RECENT_SCAN]
    )
    for entry in latest:
        try:
            ref = UUID(entry.food_ref or "")
        except ValueError:
            continue
        if ref not in refs:
            refs.append(ref)
        if len(refs) >= MAX_RECENT:
            break
    foods = {food.pk: food for food in _visible(owner).filter(pk__in=refs, is_active=True)}
    return [foods[ref] for ref in refs if ref in foods]


def export_journal(*, owner: User) -> list[dict[str, Any]]:
    """Journal de `owner` en clair, pour l'export RGPD."""
    return [
        {
            "date": view.date.isoformat(),
            "meal": view.meal,
            "food": view.name,
            "grams": float(view.grams),
            "kcal": float(view.kcal),
            "protein_g": float(view.protein),
            "carbs_g": float(view.carbs),
            "fat_g": float(view.fat),
        }
        for view in (_view(e) for e in JournalEntry.objects.filter(owner=owner))
    ]


def export_water(*, owner: User) -> list[dict[str, Any]]:
    return [
        {"date": row.date.isoformat(), "ml": int(row.ml or 0)}
        for row in WaterIntake.objects.filter(owner=owner)
    ]


# --- Objectifs nutritionnels (ADR 0011) -----------------------------------------------------

MANUAL_FIELDS = ("kcal", "protein_g", "carbs_g", "fat_g")


@dataclass(frozen=True)
class TargetsView:
    """Objectifs du compte : données saisies, valeurs calculées (si possible), valeurs retenues
    (saisie manuelle, sinon calcul) et ce qui manque pour calculer."""

    configured: bool
    inputs: dict[str, Any] | None
    computed: calc.Targets | None
    targets: dict[str, int] | None
    missing: list[str]


def _manual(target: NutritionTarget) -> dict[str, int | None]:
    values: dict[str, int | None] = {}
    for field in MANUAL_FIELDS:
        value = getattr(target, field)
        values[field] = None if value is None else int(value)
    return values


def targets_view(*, owner: User) -> TargetsView:
    """Objectifs de `owner` ; `configured=False` tant qu'il ne les a pas activés."""
    # Import local : `accounts.selectors` importe déjà ce module (export RGPD).
    from apps.accounts.selectors import get_profile

    target = NutritionTarget.objects.filter(owner=owner).first()
    if target is None:
        return TargetsView(configured=False, inputs=None, computed=None, targets=None, missing=[])
    manual = _manual(target)
    birth = date.fromisoformat(target.birth_date or "")
    profile = get_profile(owner)
    weight = latest_weight(owner=owner)
    missing = [name for name, ok in (("profile", profile), ("weight", weight)) if ok is None]
    computed = None
    if profile is not None and weight is not None:
        computed = calc.compute(
            calc.Inputs(
                sex=target.sex or "",
                birth_date=birth,
                activity=target.activity or "",
                weight_kg=weight,
                height_m=Decimal(profile.height_m),
                goal=profile.goal,
            ),
            today=timezone.localdate(),
        )
    chosen: dict[str, int] | None = None
    if computed is not None or all(value is not None for value in manual.values()):
        chosen = {
            field: value if value is not None else int(getattr(computed, field))
            for field, value in manual.items()
        }
    return TargetsView(
        configured=True,
        inputs={
            "sex": target.sex,
            "birth_date": birth.isoformat(),
            "activity": target.activity,
            **manual,
        },
        computed=computed,
        targets=chosen,
        missing=missing,
    )


def export_targets(*, owner: User) -> dict[str, Any] | None:
    """Objectifs de `owner` en clair, pour l'export RGPD."""
    view = targets_view(owner=owner)
    return view.inputs
