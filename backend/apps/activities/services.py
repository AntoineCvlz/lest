"""Écritures du domaine `activities` (ADR 0012) : idempotentes sous l'UUID du client, valeurs
validées contre le catalogue des sports avant chiffrement."""

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.services import lock_account
from apps.activities.models import (
    MAX_ACTIVITIES_PER_DAY,
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
from common.period import EARLIEST


class NotFoundError(Exception):
    """Identifiant d'un autre compte : répondu comme un identifiant inconnu (404)."""


@dataclass(frozen=True)
class ActivityValues:
    day: date
    sport: str
    duration_s: int
    distance_m: Decimal | None = None
    avg_heart_rate: int | None = None
    feeling: int | None = None
    metrics: dict[str, int] = field(default_factory=dict)


def _invalid(name: str, code: str) -> ValidationError:
    # Message fixe : jamais la valeur saisie (donnée de santé, `common.problems`).
    return ValidationError({name: ValidationError("Valeur refusée.", code=code)})


def _between(value: int | None, low: int, high: int) -> bool:
    return value is None or low <= value <= high


def _check(values: ActivityValues) -> None:
    if not EARLIEST <= values.day <= timezone.localdate() + timedelta(days=1):
        raise _invalid("date", "out_of_range")
    sport = SPORTS.get(values.sport)
    if sport is None:
        raise _invalid("sport", "invalid_choice")
    if not MIN_DURATION_S <= values.duration_s <= MAX_DURATION_S:
        raise _invalid("duration_s", "out_of_range")
    if values.distance_m is not None:
        if not sport.has_distance:
            raise _invalid("distance_m", "not_allowed")
        if not Decimal(0) <= values.distance_m <= MAX_DISTANCE_M:
            raise _invalid("distance_m", "out_of_range")
    if not _between(values.avg_heart_rate, MIN_HEART_RATE, MAX_HEART_RATE):
        raise _invalid("avg_heart_rate", "out_of_range")
    if not _between(values.feeling, MIN_FEELING, MAX_FEELING):
        raise _invalid("feeling", "out_of_range")
    for key, value in values.metrics.items():
        metric = sport.metric(key)
        if metric is None:
            raise _invalid("metrics", "unknown")
        if not metric.minimum <= value <= metric.maximum:
            raise _invalid("metrics", "out_of_range")


def put_activity(
    *, owner: User, activity_id: UUID, values: ActivityValues
) -> tuple[Activity, bool]:
    """Crée ou remplace l'activité `activity_id` de `owner` ; renvoie l'activité et `True` si
    elle est créée.

    Lève `NotFoundError` (activité d'un autre compte) ou `ValidationError` (champs et codes,
    sans la valeur : date, sport, bornes, métrique inconnue ou hors bornes, distance pour un
    sport qui n'en a pas, plafond du jour).
    """
    _check(values)
    with transaction.atomic():
        # Sérialise les saisies du compte : le plafond du jour ne peut pas être dépassé à deux.
        lock_account(owner)
        existing = Activity.objects.select_for_update().filter(pk=activity_id).first()
        if existing is not None and existing.owner_id != owner.pk:
            raise NotFoundError
        if (
            existing is None
            and Activity.objects.filter(owner=owner, date=values.day).count()
            >= MAX_ACTIVITIES_PER_DAY
        ):
            raise _invalid("activity_id", "too_many")
        activity = existing or Activity(id=activity_id, owner=owner)
        activity.date = values.day
        activity.sport = values.sport
        activity.duration_s = Decimal(values.duration_s)
        activity.distance_m = values.distance_m
        activity.avg_heart_rate = (
            None if values.avg_heart_rate is None else Decimal(values.avg_heart_rate)
        )
        activity.feeling = None if values.feeling is None else Decimal(values.feeling)
        activity.metrics = json.dumps(values.metrics, sort_keys=True)
        activity.save(force_insert=existing is None)
    return activity, existing is None


def delete_activity(*, owner: User, activity_id: UUID) -> None:
    """Supprime l'activité `activity_id` de `owner` ; sans effet si elle n'existe pas ou
    appartient à un autre compte (idempotent)."""
    Activity.objects.filter(owner=owner, pk=activity_id).delete()
