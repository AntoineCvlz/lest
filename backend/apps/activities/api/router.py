"""Activités (ADR 0012) : catalogue des sports, lecture par période bornée, `PUT` et `DELETE`
idempotents sous l'UUID du client.

Router mince : schémas Pydantic, appel du service ou du selector. Une erreur de validation ne
renvoie jamais la valeur saisie (donnée de santé, `common.problems`).
"""

from datetime import date
from decimal import Decimal
from typing import Literal

from allauth.core import ratelimit
from django.http import Http404, HttpRequest
from ninja import Field, Query, Router, Schema, Status
from pydantic import UUID4

from apps.accounts.models import User
from apps.activities import selectors, services
from apps.activities.models import (
    MAX_DISTANCE_M,
    MAX_DURATION_S,
    MAX_FEELING,
    MAX_HEART_RATE,
    MIN_DURATION_S,
    MIN_FEELING,
    MIN_HEART_RATE,
    Activity,
)
from apps.activities.sports import SPORTS
from common.auth import request_user
from common.period import Period
from common.problems import ProblemError

router = Router(tags=["activities"])

RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
WRITE_ACTION = "activities_write"
MAX_METRICS = 10

# Clés de `SPORTS` (un test vérifie qu'elles restent alignées) : énumération dans l'OpenAPI.
SportKey = Literal[
    "running",
    "cycling",
    "swimming",
    "walking",
    "hiking",
    "rowing",
    "cardio",
    "team_sport",
    "racket",
    "combat",
    "climbing",
    "yoga",
    "other",
]


class MetricOut(Schema):
    key: str
    label: str
    unit: str
    min: int
    max: int


class SportOut(Schema):
    key: SportKey
    label: str
    has_distance: bool
    metrics: list[MetricOut]


class ActivityIn(Schema):
    date: date
    sport: SportKey
    duration_s: int = Field(ge=MIN_DURATION_S, le=MAX_DURATION_S, strict=True)
    distance_m: Decimal | None = Field(
        default=None, ge=0, le=MAX_DISTANCE_M, max_digits=8, decimal_places=1
    )
    avg_heart_rate: int | None = Field(
        default=None, ge=MIN_HEART_RATE, le=MAX_HEART_RATE, strict=True
    )
    feeling: int | None = Field(default=None, ge=MIN_FEELING, le=MAX_FEELING, strict=True)
    metrics: dict[str, int] = Field(default_factory=dict, max_length=MAX_METRICS)


class ActivityOut(Schema):
    id: UUID4
    date: date
    sport: SportKey
    duration_s: int
    distance_m: float | None
    avg_heart_rate: int | None
    feeling: int | None
    metrics: dict[str, int]


def _writer(request: HttpRequest) -> User:
    user = request_user(request)
    if ratelimit.consume_or_429(request, action=WRITE_ACTION, user=user) is not None:
        raise ProblemError(
            429, "Trop d'écritures. Réessayez dans un instant.", type_=RATE_LIMITED_TYPE
        )
    return user


def _integer(value: Decimal | None) -> int | None:
    return None if value is None else int(value)


def _activity_out(activity: Activity) -> ActivityOut:
    return ActivityOut.model_validate(
        {
            "id": activity.id,
            "date": activity.date,
            "sport": activity.sport,
            "duration_s": int(activity.duration_s or 0),
            "distance_m": None if activity.distance_m is None else float(activity.distance_m),
            "avg_heart_rate": _integer(activity.avg_heart_rate),
            "feeling": _integer(activity.feeling),
            "metrics": activity.metric_values(),
        }
    )


@router.get("/sports/", response=list[SportOut], summary="Catalogue des sports")
def list_sports(request: HttpRequest) -> list[SportOut]:
    request_user(request)
    return [
        SportOut.model_validate(
            {
                "key": sport.key,
                "label": sport.label,
                "has_distance": sport.has_distance,
                "metrics": [
                    {
                        "key": m.key,
                        "label": m.label,
                        "unit": m.unit,
                        "min": m.minimum,
                        "max": m.maximum,
                    }
                    for m in sport.metrics
                ],
            }
        )
        for sport in SPORTS.values()
    ]


@router.get("/activities/", response=list[ActivityOut], summary="Activités d'une période")
def list_activities(request: HttpRequest, period: Query[Period]) -> list[ActivityOut]:
    start, end = period.bounds()
    rows = selectors.list_activities(owner=request_user(request), start=start, end=end)
    return [_activity_out(row) for row in rows]


@router.put(
    "/activities/{activity_id}/",
    response={200: ActivityOut, 201: ActivityOut},
    summary="Enregistrer ou remplacer une activité",
)
def write_activity(
    request: HttpRequest, activity_id: UUID4, payload: ActivityIn
) -> Status[ActivityOut]:
    try:
        activity, created = services.put_activity(
            owner=_writer(request),
            activity_id=activity_id,
            values=services.ActivityValues(
                day=payload.date,
                sport=payload.sport,
                duration_s=payload.duration_s,
                distance_m=payload.distance_m,
                avg_heart_rate=payload.avg_heart_rate,
                feeling=payload.feeling,
                metrics=payload.metrics,
            ),
        )
    except services.NotFoundError as error:
        raise Http404 from error
    return Status(201 if created else 200, _activity_out(activity))


@router.delete("/activities/{activity_id}/", response={204: None}, summary="Supprimer une activité")
def remove_activity(request: HttpRequest, activity_id: UUID4) -> Status[None]:
    services.delete_activity(owner=_writer(request), activity_id=activity_id)
    return Status(204, None)
