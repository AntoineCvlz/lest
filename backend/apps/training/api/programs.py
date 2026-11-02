"""Programmes : séances types et cibles, écrits comme les séances (ADR 0003) — `PUT` idempotent
sur un UUID du client, `DELETE` idempotent ; un identifiant d'un autre compte répond 404, un
parent inconnu 422."""

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
    ImageOut,
    _conflict,
    _main_image,
    _status,
    _writer,
)
from apps.training.models import (
    MAX_TARGET_REPS,
    MAX_TARGET_SETS,
    Program,
    ProgramDay,
    ProgramExercise,
)
from common.auth import request_user

router = Router(tags=["programs"])


def _printable(name: str) -> str:
    # Caractères de contrôle (dont NUL, refusé par Postgres) : jamais dans un nom affiché.
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in name):
        msg = "Caractère non autorisé."
        raise ValueError(msg)
    return name


# Nom saisi par l'utilisateur : espaces de bord retirés, puis 1 à 80 caractères imprimables.
Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    AfterValidator(_printable),
]


class ProgramIn(Schema):
    name: Name


class ProgramDayIn(Schema):
    program_id: ClientId
    name: Name
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)


class ProgramExerciseIn(Schema):
    day_id: ClientId
    exercise_id: UUID
    position: int = Field(strict=True, ge=0, le=MAX_POSITION)
    target_sets: int = Field(strict=True, ge=1, le=MAX_TARGET_SETS)
    target_reps: int = Field(strict=True, ge=1, le=MAX_TARGET_REPS)


class ProgramExerciseOut(Schema):
    id: UUID
    day_id: UUID
    exercise_id: UUID
    position: int
    target_sets: int
    target_reps: int


class ProgramExerciseDetailOut(ProgramExerciseOut):
    exercise_name: str
    exercise_name_language: str
    exercise_category: CategoryName
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


def _exercise_out(planned: ProgramExercise) -> ProgramExerciseOut:
    return ProgramExerciseOut(
        id=planned.pk,
        day_id=planned.day_id,
        exercise_id=planned.exercise_id,
        position=planned.position,
        target_sets=planned.target_sets,
        target_reps=planned.target_reps,
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
            target_sets=payload.target_sets,
            target_reps=payload.target_reps,
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
