"""Tableau de bord (ADR 0013) : une route, lectures du seul compte connecté.

Router mince : le sélecteur calcule, le schéma convertit (décimaux en nombres, semaines en
dates ISO)."""

from datetime import date
from typing import Literal

from allauth.core import ratelimit
from django.http import HttpRequest
from django.utils import timezone
from ninja import Router, Schema

from apps.insights import selectors
from common.auth import request_user
from common.problems import ProblemError

router = Router(tags=["insights"])

RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
READ_ACTION = "insights_read"


class PaceRangeOut(Schema):
    low_kg: float
    high_kg: float


class WeightInsightOut(Schema):
    trend_kg: float | None
    change_4w_kg: float | None
    change_12w_kg: float | None
    pace_kg_per_week: float | None
    goal: Literal["gain", "maintain", "cut"] | None
    pace_range: PaceRangeOut | None
    pace_status: Literal["below", "within", "above"] | None


class ActivityWeekOut(Schema):
    week: date
    workouts: int
    workout_duration_s: int
    activities: int
    activity_duration_s: int
    distance_m: float


class AdherenceOut(Schema):
    days: int
    logged_days: int
    kcal_days: int
    protein_days: int


class NutritionInsightOut(Schema):
    configured: bool
    kcal_target: int | None
    protein_target: int | None
    last_7: AdherenceOut | None
    last_28: AdherenceOut | None


class MuscleWeekOut(Schema):
    week: date
    muscle: str
    sets: int
    volume_kg: float


class DashboardOut(Schema):
    weight: WeightInsightOut
    weeks: list[ActivityWeekOut]
    nutrition: NutritionInsightOut
    muscles: list[MuscleWeekOut]


def _float(value: object) -> float | None:
    return None if value is None else float(str(value))


@router.get("/insights/dashboard/", response=DashboardOut, summary="Tableau de bord")
def dashboard(request: HttpRequest) -> DashboardOut:
    owner = request_user(request)
    # GET compté aussi (`limit_get`) : chaque lecture agrège tout le compte sur 12 semaines.
    if (
        ratelimit.consume_or_429(request, action=READ_ACTION, user=owner, limit_get=True)
        is not None
    ):
        raise ProblemError(
            429, "Trop de demandes. Réessayez dans un instant.", type_=RATE_LIMITED_TYPE
        )
    data = selectors.dashboard(owner=owner, today=timezone.localdate())
    w = data.weight
    return DashboardOut.model_validate(
        {
            "weight": {
                "trend_kg": _float(w.trend_kg),
                "change_4w_kg": _float(w.change_4w_kg),
                "change_12w_kg": _float(w.change_12w_kg),
                "pace_kg_per_week": _float(w.pace_kg_per_week),
                "goal": w.goal,
                "pace_range": (
                    {"low_kg": float(w.pace_range[0]), "high_kg": float(w.pace_range[1])}
                    if w.pace_range
                    else None
                ),
                "pace_status": w.pace_status,
            },
            "weeks": [
                {**week.__dict__, "distance_m": float(week.distance_m)} for week in data.weeks
            ],
            "nutrition": data.nutrition.__dict__
            | {
                "last_7": data.nutrition.last_7.__dict__ if data.nutrition.last_7 else None,
                "last_28": data.nutrition.last_28.__dict__ if data.nutrition.last_28 else None,
            },
            "muscles": [{**m.__dict__, "volume_kg": float(m.volume_kg)} for m in data.muscles],
        }
    )
