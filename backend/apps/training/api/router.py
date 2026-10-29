"""Séances et séries (ADR 0003) : `PUT` idempotent sur un UUID du client, `DELETE` idempotent.

Routers minces : schémas Pydantic, appel du service, traduction des erreurs. Un identifiant
d'un autre compte répond 404 comme un identifiant inconnu ; un parent inconnu, 422.
"""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from django.http import Http404, HttpRequest
from ninja import Field, Router, Schema, Status
from pydantic import AwareDatetime

from apps.training import selectors, services
from apps.training.models import MAX_REPS, MAX_WEIGHT_KG, Set, Workout, WorkoutExercise
from common.auth import request_user

router = Router(tags=["training"])

MAX_POSITION = 1000


class WorkoutIn(Schema):
    started_at: AwareDatetime
    ended_at: AwareDatetime | None = None


class WorkoutExerciseIn(Schema):
    workout_id: UUID
    exercise_id: UUID
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)


class SetIn(Schema):
    workout_exercise_id: UUID
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)
    weight_kg: Decimal = Field(ge=0, le=MAX_WEIGHT_KG, max_digits=6, decimal_places=2)
    reps: int = Field(strict=True, ge=0, le=MAX_REPS)
    rpe: Decimal | None = Field(default=None, ge=1, le=10, multiple_of=0.5)
    is_warmup: bool = False
    performed_at: AwareDatetime


class SetOut(Schema):
    id: UUID
    workout_exercise_id: UUID
    position: int
    weight_kg: float
    reps: int
    rpe: float | None
    is_warmup: bool
    performed_at: datetime


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
    )


def _workout_exercise_out(item: WorkoutExercise) -> WorkoutExerciseOut:
    return WorkoutExerciseOut(
        id=item.pk, workout_id=item.workout_id, exercise_id=item.exercise_id, position=item.position
    )


def _workout_out(workout: Workout) -> WorkoutOut:
    return WorkoutOut(id=workout.pk, started_at=workout.started_at, ended_at=workout.ended_at)


def _status[T](created: bool, body: T) -> Status[T]:
    return Status(201 if created else 200, body)


@router.get("/workouts/{workout_id}/", response=WorkoutDetailOut, summary="Séance et séries")
def read_workout(request: HttpRequest, workout_id: UUID) -> WorkoutDetailOut:
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
def write_workout(request: HttpRequest, workout_id: UUID, payload: WorkoutIn) -> Status[WorkoutOut]:
    try:
        workout, created = services.put_workout(
            owner=request_user(request),
            workout_id=workout_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    return _status(created, _workout_out(workout))


@router.delete("/workouts/{workout_id}/", response={204: None}, summary="Supprimer une séance")
def remove_workout(request: HttpRequest, workout_id: UUID) -> Status[None]:
    services.delete_workout(owner=request_user(request), workout_id=workout_id)
    return Status(204, None)


@router.put(
    "/workout-exercises/{workout_exercise_id}/",
    response={200: WorkoutExerciseOut, 201: WorkoutExerciseOut},
    summary="Ajouter ou remplacer un exercice de séance",
)
def write_workout_exercise(
    request: HttpRequest, workout_exercise_id: UUID, payload: WorkoutExerciseIn
) -> Status[WorkoutExerciseOut]:
    try:
        item, created = services.put_workout_exercise(
            owner=request_user(request),
            workout_exercise_id=workout_exercise_id,
            workout_id=payload.workout_id,
            exercise_id=payload.exercise_id,
            position=payload.position,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    return _status(created, _workout_exercise_out(item))


@router.delete(
    "/workout-exercises/{workout_exercise_id}/",
    response={204: None},
    summary="Retirer un exercice de séance et ses séries",
)
def remove_workout_exercise(request: HttpRequest, workout_exercise_id: UUID) -> Status[None]:
    services.delete_workout_exercise(
        owner=request_user(request), workout_exercise_id=workout_exercise_id
    )
    return Status(204, None)


@router.put("/sets/{set_id}/", response={200: SetOut, 201: SetOut}, summary="Enregistrer une série")
def write_set(request: HttpRequest, set_id: UUID, payload: SetIn) -> Status[SetOut]:
    try:
        one, created = services.put_set(
            owner=request_user(request),
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
    return _status(created, _set_out(one))


@router.delete("/sets/{set_id}/", response={204: None}, summary="Supprimer une série")
def remove_set(request: HttpRequest, set_id: UUID) -> Status[None]:
    services.delete_set(owner=request_user(request), set_id=set_id)
    return Status(204, None)
