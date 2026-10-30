"""Séances et séries (ADR 0003) : `PUT` idempotent sur un UUID du client, `DELETE` idempotent.

Routers minces : schémas Pydantic, appel du service, traduction des erreurs. Un identifiant
d'un autre compte répond 404 comme un identifiant inconnu ; un parent inconnu, 422.
"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from allauth.core import ratelimit
from django.http import Http404, HttpRequest
from django.utils import timezone
from ninja import Field, Query, Router, Schema, Status
from pydantic import UUID4, AfterValidator, AwareDatetime

from apps.accounts.models import User
from apps.training import selectors, services
from apps.training.models import (
    MAX_REPS,
    MAX_WEIGHT_KG,
    Category,
    Equipment,
    Exercise,
    Muscle,
    PersonalRecord,
    Set,
    Workout,
    WorkoutExercise,
)
from common.auth import request_user
from common.pagination import DEFAULT_LIMIT, MAX_LIMIT, InvalidCursorError
from common.problems import ProblemError

router = Router(tags=["training"])

MAX_POSITION = 1000
EARLIEST = datetime(2000, 1, 1, tzinfo=UTC)
WRITE_CONFLICT_TYPE = "urn:lest:problem:write-conflict"
RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
INVALID_CURSOR_TYPE = "urn:lest:problem:invalid-cursor"
# Écritures de séance par compte (`ACCOUNT_RATE_LIMITS`) : une file hors ligne rejoue vite,
# un script pas indéfiniment (chaque écriture recalcule des records).
WRITE_ACTION = "training_write"


def _plausible(moment: datetime) -> datetime:
    # Une horloge déréglée ne doit pas écrire une date que la relecture (et l'export RGPD) ne
    # saurait plus représenter : de 2000 à demain au plus tard.
    if not EARLIEST <= moment <= timezone.now() + timedelta(days=1):
        msg = "Date hors de la plage acceptée."
        raise ValueError(msg)
    return moment


# Identifiants générés par le client : UUID version 4 seulement (ni nul, ni v1 prévisible).
ClientId = UUID4
Moment = Annotated[AwareDatetime, AfterValidator(_plausible)]


class WorkoutIn(Schema):
    started_at: Moment
    ended_at: Moment | None = None


class WorkoutExerciseIn(Schema):
    workout_id: ClientId
    exercise_id: UUID
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)


class SetIn(Schema):
    workout_exercise_id: ClientId
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)
    weight_kg: Decimal = Field(ge=0, le=MAX_WEIGHT_KG, max_digits=6, decimal_places=2)
    reps: int = Field(strict=True, ge=0, le=MAX_REPS)
    rpe: Decimal | None = Field(default=None, ge=1, le=10, multiple_of=0.5)
    is_warmup: bool = False
    performed_at: Moment


# --- Catalogue (commun à tous les comptes, lecture seule) -----------------------------------

# Valeurs de `Category` (un test vérifie qu'elles restent alignées) : énumération dans l'OpenAPI.
CategoryName = Literal["abs", "arms", "back", "calves", "cardio", "chest", "legs", "shoulders"]
MAX_QUERY_LENGTH = 100


class ExerciseQuery(Schema):
    q: str = Field("", max_length=MAX_QUERY_LENGTH)
    category: CategoryName | None = None
    muscle: int | None = Field(None, ge=1)
    equipment: int | None = Field(None, ge=1)
    cursor: str | None = None
    limit: int = Field(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)


class NamedOut(Schema):
    id: int
    name: str


class ExerciseOut(Schema):
    id: UUID
    name: str
    # « en » : pas de nom français dans wger, le nom anglais est affiché (ADR 0004).
    name_language: Literal["fr", "en"]
    category: CategoryName
    muscles: list[NamedOut]
    equipment: list[NamedOut]


class ExerciseDetailOut(ExerciseOut):
    secondary_muscles: list[NamedOut]
    # Attribution exigée par la licence de wger (CC-BY-SA), affichée avec l'exercice.
    license: str
    license_author: str
    is_active: bool


class ExercisePageOut(Schema):
    items: list[ExerciseOut]
    next_cursor: str | None


class ExerciseFiltersOut(Schema):
    categories: list[CategoryName]
    muscles: list[NamedOut]
    equipment: list[NamedOut]


class RecordOut(Schema):
    kind: Literal["weight", "e1rm"]
    value_kg: float
    achieved_at: datetime


class SetOut(Schema):
    id: UUID
    workout_exercise_id: UUID
    position: int
    weight_kg: float
    reps: int
    rpe: float | None
    is_warmup: bool
    performed_at: datetime
    # Records établis par cette série (« Nouveau record » à l'écran).
    records: list[RecordOut]


class ExerciseRecordsOut(Schema):
    history: list[RecordOut]


class WorkoutExerciseOut(Schema):
    id: UUID
    workout_id: UUID
    exercise_id: UUID
    position: int


class WorkoutExerciseDetailOut(WorkoutExerciseOut):
    exercise_name: str
    exercise_name_language: str
    sets: list[SetOut]


class WorkoutOut(Schema):
    id: UUID
    started_at: datetime
    ended_at: datetime | None


class WorkoutDetailOut(WorkoutOut):
    volume_kg: float
    exercises: list[WorkoutExerciseDetailOut]


def _named(rows: Iterable[Muscle | Equipment]) -> list[NamedOut]:
    return [NamedOut(id=row.pk, name=row.name) for row in rows]


def _exercise_out(exercise: Exercise) -> ExerciseOut:
    return ExerciseOut(
        id=exercise.pk,
        name=exercise.name,
        name_language=exercise.name_language,  # type: ignore[arg-type]  # contrainte en base
        category=exercise.category,  # type: ignore[arg-type]  # contrainte en base
        muscles=_named(exercise.muscles.all()),
        equipment=_named(exercise.equipment.all()),
    )


def _set_out(one: Set) -> SetOut:
    return SetOut(
        id=one.pk,
        workout_exercise_id=one.workout_exercise_id,
        position=one.position,
        weight_kg=float(one.weight_kg),
        reps=one.reps,
        rpe=float(one.rpe) if one.rpe is not None else None,
        is_warmup=one.is_warmup,
        performed_at=one.performed_at,
        records=[_record_out(record) for record in one.records.all()],
    )


def _record_out(record: PersonalRecord) -> RecordOut:
    return RecordOut(
        kind=record.kind,  # type: ignore[arg-type]  # garanti par la contrainte en base
        value_kg=float(record.value_kg),
        achieved_at=record.achieved_at,
    )


def _workout_exercise_out(item: WorkoutExercise) -> WorkoutExerciseOut:
    return WorkoutExerciseOut(
        id=item.pk, workout_id=item.workout_id, exercise_id=item.exercise_id, position=item.position
    )


def _workout_out(workout: Workout) -> WorkoutOut:
    return WorkoutOut(id=workout.pk, started_at=workout.started_at, ended_at=workout.ended_at)


def _status[T](created: bool, body: T) -> Status[T]:
    return Status(201 if created else 200, body)


def _conflict() -> ProblemError:
    return ProblemError(409, "Écriture refusée, réessayez.", type_=WRITE_CONFLICT_TYPE)


def _writer(request: HttpRequest) -> User:
    """Compte qui écrit, après la limite de débit des écritures de séance (429 au-delà)."""
    user = request_user(request)
    if not ratelimit.consume(request, action=WRITE_ACTION, user=user):
        raise ProblemError(
            429, "Trop d'écritures. Réessayez dans un instant.", type_=RATE_LIMITED_TYPE
        )
    return user


@router.get("/exercises/", response=ExercisePageOut, summary="Rechercher dans le catalogue")
def list_exercises(request: HttpRequest, filters: Query[ExerciseQuery]) -> ExercisePageOut:
    try:
        page = selectors.search_exercises(
            query=filters.q,
            category=filters.category,
            muscle_id=filters.muscle,
            equipment_id=filters.equipment,
            cursor=filters.cursor,
            limit=filters.limit,
        )
    except InvalidCursorError as error:
        raise ProblemError(
            422, "Curseur de pagination invalide.", type_=INVALID_CURSOR_TYPE
        ) from error
    return ExercisePageOut(
        items=[_exercise_out(one) for one in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/exercises/{exercise_id}/", response=ExerciseDetailOut, summary="Fiche d'exercice")
def read_exercise(request: HttpRequest, exercise_id: UUID) -> ExerciseDetailOut:
    exercise = selectors.get_exercise(exercise_id=exercise_id)
    if exercise is None:
        raise Http404
    return ExerciseDetailOut(
        **_exercise_out(exercise).model_dump(),
        secondary_muscles=_named(exercise.secondary_muscles.all()),
        license=exercise.license,
        license_author=exercise.license_author,
        is_active=exercise.is_active,
    )


@router.get("/exercise-filters/", response=ExerciseFiltersOut, summary="Valeurs des filtres")
def read_exercise_filters(request: HttpRequest) -> ExerciseFiltersOut:
    muscles, equipment = selectors.exercise_filters()
    return ExerciseFiltersOut(
        categories=list(Category.values),  # type: ignore[arg-type]  # aligné, voir les tests
        muscles=_named(muscles),
        equipment=_named(equipment),
    )


@router.get("/workouts/{workout_id}/", response=WorkoutDetailOut, summary="Séance et séries")
def read_workout(request: HttpRequest, workout_id: ClientId) -> WorkoutDetailOut:
    workout = selectors.get_workout(owner=request_user(request), workout_id=workout_id)
    if workout is None:
        raise Http404
    return WorkoutDetailOut(
        id=workout.pk,
        started_at=workout.started_at,
        ended_at=workout.ended_at,
        volume_kg=float(selectors.workout_volume_kg(workout)),
        exercises=[
            WorkoutExerciseDetailOut(
                id=item.pk,
                workout_id=item.workout_id,
                exercise_id=item.exercise_id,
                position=item.position,
                exercise_name=item.exercise.name,
                exercise_name_language=item.exercise.name_language,
                sets=[_set_out(one) for one in item.sets.all()],
            )
            for item in workout.exercises.all()
        ],
    )


@router.put(
    "/workouts/{workout_id}/",
    response={200: WorkoutOut, 201: WorkoutOut},
    summary="Créer ou remplacer une séance",
)
def write_workout(
    request: HttpRequest, workout_id: ClientId, payload: WorkoutIn
) -> Status[WorkoutOut]:
    try:
        workout, created = services.put_workout(
            owner=_writer(request),
            workout_id=workout_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _workout_out(workout))


@router.delete("/workouts/{workout_id}/", response={204: None}, summary="Supprimer une séance")
def remove_workout(request: HttpRequest, workout_id: ClientId) -> Status[None]:
    services.delete_workout(owner=_writer(request), workout_id=workout_id)
    return Status(204, None)


@router.put(
    "/workout-exercises/{workout_exercise_id}/",
    response={200: WorkoutExerciseOut, 201: WorkoutExerciseOut},
    summary="Ajouter ou remplacer un exercice de séance",
)
def write_workout_exercise(
    request: HttpRequest, workout_exercise_id: ClientId, payload: WorkoutExerciseIn
) -> Status[WorkoutExerciseOut]:
    try:
        item, created = services.put_workout_exercise(
            owner=_writer(request),
            workout_exercise_id=workout_exercise_id,
            workout_id=payload.workout_id,
            exercise_id=payload.exercise_id,
            position=payload.position,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _workout_exercise_out(item))


@router.delete(
    "/workout-exercises/{workout_exercise_id}/",
    response={204: None},
    summary="Retirer un exercice de séance et ses séries",
)
def remove_workout_exercise(request: HttpRequest, workout_exercise_id: ClientId) -> Status[None]:
    services.delete_workout_exercise(
        owner=_writer(request), workout_exercise_id=workout_exercise_id
    )
    return Status(204, None)


@router.put("/sets/{set_id}/", response={200: SetOut, 201: SetOut}, summary="Enregistrer une série")
def write_set(request: HttpRequest, set_id: ClientId, payload: SetIn) -> Status[SetOut]:
    try:
        one, created = services.put_set(
            owner=_writer(request),
            set_id=set_id,
            workout_exercise_id=payload.workout_exercise_id,
            position=payload.position,
            weight_kg=payload.weight_kg,
            reps=payload.reps,
            rpe=payload.rpe,
            is_warmup=payload.is_warmup,
            performed_at=payload.performed_at,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _set_out(one))


@router.get(
    "/exercises/{exercise_id}/records/",
    response=ExerciseRecordsOut,
    summary="Historique des records d'un exercice",
)
def read_exercise_records(request: HttpRequest, exercise_id: UUID) -> ExerciseRecordsOut:
    history = selectors.records_history(owner=request_user(request), exercise_id=exercise_id)
    return ExerciseRecordsOut(history=[_record_out(record) for record in history])


@router.delete("/sets/{set_id}/", response={204: None}, summary="Supprimer une série")
def remove_set(request: HttpRequest, set_id: ClientId) -> Status[None]:
    services.delete_set(owner=_writer(request), set_id=set_id)
    return Status(204, None)
