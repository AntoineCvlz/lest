"""Programmes : séances types et cibles, écrits comme les séances (ADR 0003) — `PUT` idempotent
sur un UUID du client, `DELETE` idempotent ; un identifiant d'un autre compte répond 404, un
parent inconnu 422."""

from decimal import Decimal
from typing import Annotated
from uuid import UUID

from django.http import Http404, HttpRequest
from ninja import Field, Router, Schema, Status
from pydantic import AfterValidator, StringConstraints

from apps.training import selectors, services
from apps.training.api.router import (
    MAX_POSITION,
    CategoryName,
    ClientId,
    ExerciseKindName,
    ImageOut,
    Note,
    SetTypeName,
    _conflict,
    _main_image,
    _status,
    _writer,
)
from apps.training.models import (
    MAX_DISTANCE_M,
    MAX_DURATION_S,
    MAX_REPS,
    MAX_REST_SECONDS,
    MAX_SUPERSET,
    MAX_TARGET_REPS,
    MAX_TARGET_SETS,
    MAX_WEIGHT_KG,
    MIN_REST_SECONDS,
    Program,
    ProgramDay,
    ProgramExercise,
    ProgramSet,
    SetType,
)
from common.auth import request_user
from common.problems import ProblemError
from common.text import printable

router = Router(tags=["programs"])

NO_ROUTINE_TYPE = "urn:lest:problem:no-routine"


# Nom saisi par l'utilisateur : espaces de bord retirés, puis 1 à 80 caractères imprimables.
Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    AfterValidator(printable),
]


class ProgramIn(Schema):
    name: Name


class ProgramDayIn(Schema):
    program_id: ClientId
    name: Name
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)


class ProgramExerciseIn(Schema):
    """Exercice de routine. Repos, superset, note : absent, gardé ; `null`, effacé (comme les
    exercices de séance). `target_sets` et `target_reps` ensemble : raccourci de l'écran
    actuel, qui réécrit les séries prévues (transition, ADR 0017)."""

    day_id: ClientId
    exercise_id: UUID
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)
    rest_seconds: int | None = Field(
        default=None, strict=True, ge=MIN_REST_SECONDS, le=MAX_REST_SECONDS
    )
    superset: int | None = Field(default=None, strict=True, ge=1, le=MAX_SUPERSET)
    note: Note | None = None
    target_sets: int | None = Field(default=None, strict=True, ge=1, le=MAX_TARGET_SETS)
    target_reps: int | None = Field(default=None, strict=True, ge=1, le=MAX_TARGET_REPS)

    def details(self) -> dict[str, object]:
        fields = ("rest_seconds", "superset", "note")
        values = {field: getattr(self, field) for field in fields if field in self.model_fields_set}
        if "note" in values:
            values["note"] = values["note"] or None
        return values

    def targets(self) -> tuple[int, int] | None:
        if self.target_sets is None or self.target_reps is None:
            return None
        return self.target_sets, self.target_reps


class ProgramSetIn(Schema):
    """Série prévue : colonnes du type de l'exercice seulement, toutes facultatives."""

    program_exercise_id: ClientId
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)
    set_type: SetTypeName = "normal"
    weight_kg: Decimal | None = Field(
        default=None, ge=0, le=MAX_WEIGHT_KG, max_digits=6, decimal_places=2
    )
    reps: int | None = Field(default=None, strict=True, ge=0, le=MAX_REPS)
    duration_s: int | None = Field(default=None, strict=True, ge=0, le=MAX_DURATION_S)
    distance_m: Decimal | None = Field(
        default=None, ge=0, le=MAX_DISTANCE_M, max_digits=8, decimal_places=1
    )


class ProgramSetOut(Schema):
    id: UUID
    program_exercise_id: UUID
    position: int
    set_type: SetTypeName
    weight_kg: float | None
    reps: int | None
    duration_s: int | None
    distance_m: float | None


class ProgramExerciseOut(Schema):
    id: UUID
    day_id: UUID
    exercise_id: UUID
    position: int
    rest_seconds: int | None
    superset: int | None
    note: str | None
    sets: list[ProgramSetOut]
    # Tirés des séries prévues pour l'écran actuel (séries de travail, répétitions de la
    # première) ; `None` sans série prévue avec des répétitions.
    target_sets: int | None
    target_reps: int | None


class ProgramExerciseDetailOut(ProgramExerciseOut):
    exercise_name: str
    exercise_name_language: str
    exercise_category: CategoryName
    exercise_kind: ExerciseKindName
    exercise_image: ImageOut | None


class ProgramDayOut(Schema):
    id: UUID
    program_id: UUID
    name: str
    position: int


class ProgramDayDetailOut(ProgramDayOut):
    exercises: list[ProgramExerciseDetailOut]


class ProgramOut(Schema):
    id: UUID
    name: str


class ProgramDetailOut(ProgramOut):
    days: list[ProgramDayDetailOut]


def _program_detail(program: Program) -> ProgramDetailOut:
    return ProgramDetailOut(
        id=program.pk,
        name=program.name,
        days=[
            ProgramDayDetailOut(
                id=day.pk,
                program_id=day.program_id,
                name=day.name,
                position=day.position,
                exercises=[
                    ProgramExerciseDetailOut(
                        **_exercise_out(planned).model_dump(),
                        exercise_name=planned.exercise.name,
                        exercise_name_language=planned.exercise.name_language,
                        exercise_category=planned.exercise.category,  # type: ignore[arg-type]  # contrainte en base
                        exercise_kind=planned.exercise.kind,  # type: ignore[arg-type]  # contrainte en base
                        exercise_image=_main_image(planned.exercise),
                    )
                    for planned in day.exercises.all()
                ],
            )
            for day in program.days.all()
        ],
    )


def _day_out(day: ProgramDay) -> ProgramDayOut:
    return ProgramDayOut(id=day.pk, program_id=day.program_id, name=day.name, position=day.position)


def _set_out(one: ProgramSet) -> ProgramSetOut:
    return ProgramSetOut(
        id=one.pk,
        program_exercise_id=one.program_exercise_id,
        position=one.position,
        set_type=one.set_type,  # type: ignore[arg-type]  # contrainte en base
        weight_kg=None if one.weight_kg is None else float(one.weight_kg),
        reps=one.reps,
        duration_s=one.duration_s,
        distance_m=None if one.distance_m is None else float(one.distance_m),
    )


def _exercise_out(planned: ProgramExercise) -> ProgramExerciseOut:
    sets = sorted(planned.sets.all(), key=lambda one: (one.position, str(one.pk)))
    working = [one for one in sets if one.set_type != SetType.WARMUP]
    reps = next((one.reps for one in working if one.reps is not None), None)
    return ProgramExerciseOut(
        id=planned.pk,
        day_id=planned.day_id,
        exercise_id=planned.exercise_id,
        position=planned.position,
        rest_seconds=planned.rest_seconds,
        superset=planned.superset,
        note=planned.note,
        sets=[_set_out(one) for one in sets],
        target_sets=len(working) if reps is not None else None,
        target_reps=reps,
    )


@router.get("/programs/", response=list[ProgramDetailOut], summary="Programmes")
def list_programs(request: HttpRequest) -> list[ProgramDetailOut]:
    return [_program_detail(one) for one in selectors.list_programs(owner=request_user(request))]


@router.get("/programs/{program_id}/", response=ProgramDetailOut, summary="Programme")
def read_program(request: HttpRequest, program_id: ClientId) -> ProgramDetailOut:
    program = selectors.get_program(owner=request_user(request), program_id=program_id)
    if program is None:
        raise Http404
    return _program_detail(program)


@router.put(
    "/programs/{program_id}/",
    response={200: ProgramOut, 201: ProgramOut},
    summary="Créer ou renommer un programme",
)
def write_program(
    request: HttpRequest, program_id: ClientId, payload: ProgramIn
) -> Status[ProgramOut]:
    try:
        program, created = services.put_program(
            owner=_writer(request), program_id=program_id, name=payload.name
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, ProgramOut(id=program.pk, name=program.name))


@router.delete("/programs/{program_id}/", response={204: None}, summary="Supprimer un programme")
def remove_program(request: HttpRequest, program_id: ClientId) -> Status[None]:
    services.delete_program(owner=_writer(request), program_id=program_id)
    return Status(204, None)


@router.put(
    "/program-days/{day_id}/",
    response={200: ProgramDayOut, 201: ProgramDayOut},
    summary="Créer ou remplacer une séance type",
)
def write_program_day(
    request: HttpRequest, day_id: ClientId, payload: ProgramDayIn
) -> Status[ProgramDayOut]:
    try:
        day, created = services.put_program_day(
            owner=_writer(request),
            day_id=day_id,
            program_id=payload.program_id,
            name=payload.name,
            position=payload.position,
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _day_out(day))


@router.delete("/program-days/{day_id}/", response={204: None}, summary="Supprimer une séance type")
def remove_program_day(request: HttpRequest, day_id: ClientId) -> Status[None]:
    services.delete_program_day(owner=_writer(request), day_id=day_id)
    return Status(204, None)


@router.put(
    "/program-exercises/{program_exercise_id}/",
    response={200: ProgramExerciseOut, 201: ProgramExerciseOut},
    summary="Ajouter ou remplacer un exercice de séance type",
)
def write_program_exercise(
    request: HttpRequest, program_exercise_id: ClientId, payload: ProgramExerciseIn
) -> Status[ProgramExerciseOut]:
    try:
        planned, created = services.put_program_exercise(
            owner=_writer(request),
            program_exercise_id=program_exercise_id,
            day_id=payload.day_id,
            exercise_id=payload.exercise_id,
            position=payload.position,
            details=payload.details(),
            targets=payload.targets(),
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _exercise_out(planned))


@router.delete(
    "/program-exercises/{program_exercise_id}/",
    response={204: None},
    summary="Retirer un exercice de séance type",
)
def remove_program_exercise(request: HttpRequest, program_exercise_id: ClientId) -> Status[None]:
    services.delete_program_exercise(
        owner=_writer(request), program_exercise_id=program_exercise_id
    )
    return Status(204, None)


@router.put(
    "/program-sets/{set_id}/",
    response={200: ProgramSetOut, 201: ProgramSetOut},
    summary="Ajouter ou remplacer une série prévue",
)
def write_program_set(
    request: HttpRequest, set_id: ClientId, payload: ProgramSetIn
) -> Status[ProgramSetOut]:
    try:
        one, created = services.put_program_set(
            owner=_writer(request),
            set_id=set_id,
            program_exercise_id=payload.program_exercise_id,
            values=services.PlannedSetValues(
                position=payload.position,
                set_type=SetType(payload.set_type),
                weight_kg=payload.weight_kg,
                reps=payload.reps,
                duration_s=payload.duration_s,
                distance_m=payload.distance_m,
            ),
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _set_out(one))


@router.delete("/program-sets/{set_id}/", response={204: None}, summary="Retirer une série prévue")
def remove_program_set(request: HttpRequest, set_id: ClientId) -> Status[None]:
    services.delete_program_set(owner=_writer(request), set_id=set_id)
    return Status(204, None)


@router.post(
    "/workouts/{workout_id}/update-routine/",
    response=ProgramDetailOut,
    summary="Mettre à jour la routine suivie avec cette séance",
)
def update_routine(request: HttpRequest, workout_id: ClientId) -> ProgramDetailOut:
    owner = _writer(request)
    try:
        day = services.update_routine_from_workout(owner=owner, workout_id=workout_id)
    except services.NotFoundError as error:
        raise Http404 from error
    except services.NoRoutineError as error:
        raise ProblemError(
            409, "Séance faite hors routine, ou routine supprimée.", type_=NO_ROUTINE_TYPE
        ) from error
    program = selectors.get_program(owner=owner, program_id=day.program_id)
    if program is None:  # supprimé entre-temps
        raise Http404
    return _program_detail(program)
