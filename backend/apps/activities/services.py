"""Écritures du domaine `activities` (ADR 0012) : idempotentes sous l'UUID du client, valeurs
validées contre le catalogue des sports avant chiffrement.

Transition (ADR 0017) : chaque activité est recopiée en séance terminée de `training`, sous des
identifiants dérivés du sien ; le Bilan lit les séances. L'app disparaît à la PR suivante."""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
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
from apps.training import selectors as training_selectors
from apps.training import services as training_services
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
        # Création ou changement de jour : une activité déplacée compte aussi pour son nouveau jour.
        if (existing is None or existing.date != values.day) and Activity.objects.filter(
            owner=owner, date=values.day
        ).exclude(pk=activity_id).count() >= MAX_ACTIVITIES_PER_DAY:
            raise _invalid("activity_id", "too_many")
        activity = existing or Activity(id=activity_id, owner=owner)
        previous_sport = activity.sport
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
        if existing is not None and previous_sport != values.sport:
            # Autre exercice, autres colonnes : la séance recopiée repart de zéro.
            training_services.delete_workout(
                owner=owner, workout_id=copied_id(activity_id, "workout")
            )
        _copy_to_workout(activity)
    return activity, existing is None


def delete_activity(*, owner: User, activity_id: UUID) -> None:
    """Supprime l'activité `activity_id` de `owner` ; sans effet si elle n'existe pas ou
    appartient à un autre compte (idempotent). Sa séance recopiée part avec elle."""
    with transaction.atomic():
        if Activity.objects.filter(owner=owner, pk=activity_id).delete()[0]:
            training_services.delete_workout(
                owner=owner, workout_id=copied_id(activity_id, "workout")
            )


# --- Recopie en séances (ADR 0017) --------------------------------------------------------


def copied_id(activity_id: UUID, role: str) -> UUID:
    """Identifiant de la séance (`workout`), de son exercice (`exercise`) ou de sa série
    (`set`) recopiés d'une activité : stable, au format v4 (ADR 0003)."""
    digest = hashlib.sha256(f"lest-activity/{role}/{activity_id}".encode()).digest()
    return UUID(bytes=digest[:16], version=4)


def _whole(value: Decimal | None) -> int | None:
    return None if value is None else int(value)


def metrics_note(activity: Activity) -> str | None:
    """Métriques du sport en texte (« Dénivelé positif : 320 m »), une par ligne ; la note de
    l'exercice recopié, chiffrée comme toute note (ADR 0017)."""
    sport = SPORTS[activity.sport]
    lines = []
    for key, value in sorted(activity.metric_values().items()):
        metric = sport.metric(key)
        if metric is not None:
            lines.append(f"{metric.label} : {value}{f' {metric.unit}' if metric.unit else ''}")
    return "\n".join(lines) or None


def _copy_to_workout(activity: Activity) -> bool:
    """Écrit la séance terminée qui reprend `activity` : début à midi (heure locale) du jour,
    fin après la durée ; un exercice de cardio de Lest, une série. Renvoie `True` si la séance
    est créée. Appelé dans la transaction de l'écriture de l'activité."""
    exercise = training_selectors.cardio_exercises()[activity.sport]
    owner = activity.owner
    duration = int(activity.duration_s or 0)
    started = datetime.combine(activity.date, time(12), tzinfo=timezone.get_current_timezone())
    ended = started + timedelta(seconds=duration)
    workout_id = copied_id(activity.pk, "workout")
    exercise_id = copied_id(activity.pk, "exercise")
    _, created = training_services.put_workout(
        owner=owner,
        workout_id=workout_id,
        started_at=started,
        ended_at=ended,
        details={
            "name": SPORTS[activity.sport].label,
            "avg_heart_rate": _whole(activity.avg_heart_rate),
            "feeling": _whole(activity.feeling),
        },
    )
    training_services.put_workout_exercise(
        owner=owner,
        workout_exercise_id=exercise_id,
        workout_id=workout_id,
        exercise_id=exercise.pk,
        position=0,
        details={"note": metrics_note(activity)},
    )
    training_services.put_set(
        owner=owner,
        set_id=copied_id(activity.pk, "set"),
        workout_exercise_id=exercise_id,
        values=training_services.SetValues(
            position=0,
            performed_at=ended,
            duration_s=duration,
            distance_m=activity.distance_m if SPORTS[activity.sport].has_distance else None,
        ),
    )
    return created


@dataclass(frozen=True)
class CopyReport:
    activities: int
    created: int


def copy_activities_to_workouts() -> CopyReport:
    """Recopie en séances les activités qui n'en ont pas encore (activités antérieures à la
    recopie automatique). Rejouable : une séance déjà recopiée n'est pas réécrite (elle a pu
    être modifiée depuis l'écran de séance)."""
    activities = Activity.objects.select_related("owner").order_by("date", "created_at")
    created = 0
    total = 0
    for activity in activities.iterator():
        total += 1
        workout_id = copied_id(activity.pk, "workout")
        if training_selectors.get_workout(owner=activity.owner, workout_id=workout_id):
            continue
        with transaction.atomic():
            created += _copy_to_workout(activity)
    return CopyReport(activities=total, created=created)


def missing_copies() -> int:
    """Activités sans leur séance recopiée (0 attendu avant de supprimer l'app)."""
    return sum(
        1
        for activity in Activity.objects.select_related("owner").iterator()
        if training_selectors.get_workout(
            owner=activity.owner, workout_id=copied_id(activity.pk, "workout")
        )
        is None
    )
