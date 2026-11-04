"""Tableau de bord (ADR 0013) : lectures agrégées par les sélecteurs des domaines, sans table
propre. Toutes les lectures sont celles du compte demandé, sur des fenêtres courtes."""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from apps.accounts.models import User
from apps.accounts.selectors import get_profile
from apps.activities.selectors import list_activities
from apps.body.selectors import WeightPoint, list_weights
from apps.nutrition.selectors import Totals, daily_totals, targets_view
from apps.training.selectors import MuscleWeek, weekly_training

WEEKS = 8
# Repères de rythme (kg par semaine) selon l'objectif du profil : ordres de grandeur génériques.
PACE_RANGES: dict[str, tuple[Decimal, Decimal]] = {
    "gain": (Decimal("0.1"), Decimal("0.5")),
    "maintain": (Decimal("-0.2"), Decimal("0.2")),
    "cut": (Decimal("-1.0"), Decimal("-0.2")),
}
# Jour « dans l'objectif » : énergie à ±10 %, protéines à 90 % au moins.
KCAL_TOLERANCE = Decimal("0.10")
PROTEIN_FLOOR = Decimal("0.90")
CENTI = Decimal("0.01")


@dataclass(frozen=True)
class WeightInsight:
    trend_kg: Decimal | None
    change_4w_kg: Decimal | None
    change_12w_kg: Decimal | None
    pace_kg_per_week: Decimal | None
    goal: str | None
    pace_range: tuple[Decimal, Decimal] | None
    # « below », « within », « above » le repère, ou `None` sans rythme ni objectif.
    pace_status: str | None


@dataclass(frozen=True)
class ActivityWeek:
    week: date
    workouts: int
    workout_duration_s: int
    activities: int
    activity_duration_s: int
    distance_m: Decimal


@dataclass(frozen=True)
class Adherence:
    days: int
    logged_days: int
    kcal_days: int
    protein_days: int


@dataclass(frozen=True)
class NutritionInsight:
    configured: bool
    kcal_target: int | None
    protein_target: int | None
    last_7: Adherence | None
    last_28: Adherence | None


@dataclass(frozen=True)
class Dashboard:
    weight: WeightInsight
    weeks: list[ActivityWeek]
    nutrition: NutritionInsight
    muscles: list[MuscleWeek]


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _weight(owner: User, today: date) -> WeightInsight:
    points = list_weights(owner=owner, start=today - timedelta(days=90), end=today)
    profile = get_profile(owner)
    goal = profile.goal if profile else None
    pace_range = PACE_RANGES.get(goal or "")
    if not points:
        return WeightInsight(None, None, None, None, goal, pace_range, None)
    now = points[-1]

    def before(days: int) -> WeightPoint | None:
        limit = now.date - timedelta(days=days)
        return next((p for p in reversed(points) if p.date <= limit), None)

    four, twelve = before(28), before(84)
    change_4w = (now.trend_kg - four.trend_kg) if four else None
    change_12w = (now.trend_kg - twelve.trend_kg) if twelve else None
    pace = None
    if four and now.date != four.date:
        weeks = Decimal((now.date - four.date).days) / 7
        pace = ((now.trend_kg - four.trend_kg) / weeks).quantize(CENTI, rounding=ROUND_HALF_UP)
    status = None
    if pace is not None and pace_range is not None:
        low, high = pace_range
        status = "below" if pace < low else "above" if pace > high else "within"
    return WeightInsight(now.trend_kg, change_4w, change_12w, pace, goal, pace_range, status)


def _weeks(owner: User, today: date) -> tuple[list[ActivityWeek], list[MuscleWeek]]:
    first = _monday(today) - timedelta(weeks=WEEKS - 1)
    workouts, muscles = weekly_training(owner=owner, start=first, end=today)
    by_week = {w.week: w for w in workouts}
    activities = list_activities(owner=owner, start=first, end=today)
    weeks = []
    for index in range(WEEKS):
        week = first + timedelta(weeks=index)
        mine = [a for a in activities if _monday(a.date) == week]
        training = by_week.get(week)
        weeks.append(
            ActivityWeek(
                week=week,
                workouts=training.workouts if training else 0,
                workout_duration_s=training.duration_s if training else 0,
                activities=len(mine),
                activity_duration_s=sum(int(a.duration_s or 0) for a in mine),
                distance_m=sum((a.distance_m or Decimal(0) for a in mine), Decimal(0)),
            )
        )
    return weeks, muscles


def _adherence(
    totals: dict[date, Totals], days: int, today: date, kcal: int, protein: int
) -> Adherence:
    window = [today - timedelta(days=n) for n in range(1, days + 1)]
    logged = [totals[d] for d in window if d in totals]
    low, high = kcal * (1 - KCAL_TOLERANCE), kcal * (1 + KCAL_TOLERANCE)
    return Adherence(
        days=days,
        logged_days=len(logged),
        kcal_days=sum(1 for t in logged if low <= t.kcal <= high),
        protein_days=sum(1 for t in logged if t.protein >= protein * PROTEIN_FLOOR),
    )


def _nutrition(owner: User, today: date) -> NutritionInsight:
    targets = targets_view(owner=owner).targets
    if targets is None:
        return NutritionInsight(False, None, None, None, None)
    kcal, protein = targets["kcal"], targets["protein_g"]
    # Journée en cours exclue : elle n'est pas finie.
    totals = daily_totals(
        owner=owner, start=today - timedelta(days=28), end=today - timedelta(days=1)
    )
    return NutritionInsight(
        True,
        kcal,
        protein,
        _adherence(totals, 7, today, kcal, protein),
        _adherence(totals, 28, today, kcal, protein),
    )


def dashboard(*, owner: User, today: date) -> Dashboard:
    """Tableau de bord de `owner` au jour `today` : poids et rythme, 8 semaines d'activité,
    adhérence nutrition sur 7 et 28 jours, volume par muscle sur 8 semaines."""
    weeks, muscles = _weeks(owner, today)
    return Dashboard(
        weight=_weight(owner, today),
        weeks=weeks,
        nutrition=_nutrition(owner, today),
        muscles=muscles,
    )
