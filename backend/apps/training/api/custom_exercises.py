"""Exercices perso (ADR 0017) : visibles de leur seul propriétaire, écrits comme les séances
(ADR 0003) — `PUT` idempotent sur un UUID du client, `DELETE` idempotent. Un identifiant du
catalogue ou d'un autre compte répond 404.

Séparés de la recherche du catalogue : celle-ci est gardée hors ligne comme une donnée
publique (ADR 0015), un exercice perso est une donnée du compte.
"""

from typing import Annotated

from django.http import Http404, HttpRequest
from ninja import Field, Router, Schema, Status
from pydantic import AfterValidator, StringConstraints

from apps.training import selectors, services
from apps.training.api.router import (
    CategoryName,
    ClientId,
    ExerciseDetailOut,
    ExerciseKindName,
    _conflict,
    _exercise_out,
    _image_out,
    _named,
    _status,
    _writer,
)
from apps.training.models import Category, Exercise, ExerciseKind
from common.auth import request_user
from common.problems import ProblemError
from common.text import printable

router = Router(tags=["training"])

IN_USE_TYPE = "urn:lest:problem:exercise-in-use"
MAX_LINKS = 10

Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    AfterValidator(printable),
]
Ids = Annotated[list[Annotated[int, Field(strict=True, ge=1)]], Field(max_length=MAX_LINKS)]


class CustomExerciseIn(Schema):
    name: Name
    kind: ExerciseKindName
    category: CategoryName
    muscle_ids: Ids = Field(default_factory=list)
    secondary_muscle_ids: Ids = Field(default_factory=list)
    equipment_ids: Ids = Field(default_factory=list)
    # Archivé : absent des choix, gardé dans l'historique.
    is_active: bool = True


class CustomExercisesOut(Schema):
    items: list[ExerciseDetailOut]


def _detail(exercise: Exercise) -> ExerciseDetailOut:
    return ExerciseDetailOut(
        **_exercise_out(exercise).model_dump(),
        secondary_muscles=_named(exercise.secondary_muscles.all()),
        images=[_image_out(image) for image in exercise.images.all()],
        license=exercise.license,
        license_author=exercise.license_author,
        is_active=exercise.is_active,
    )


@router.get("/custom-exercises/", response=CustomExercisesOut, summary="Mes exercices perso")
def list_custom_exercises(request: HttpRequest) -> CustomExercisesOut:
    exercises = selectors.list_custom_exercises(owner=request_user(request))
    return CustomExercisesOut(items=[_detail(one) for one in exercises])


@router.put(
    "/custom-exercises/{exercise_id}/",
    response={200: ExerciseDetailOut, 201: ExerciseDetailOut},
    summary="Créer ou modifier un exercice perso",
)
def write_custom_exercise(
    request: HttpRequest, exercise_id: ClientId, payload: CustomExerciseIn
) -> Status[ExerciseDetailOut]:
    try:
        exercise, created = services.put_custom_exercise(
            owner=_writer(request),
            exercise_id=exercise_id,
            values=services.CustomExerciseValues(
                name=payload.name,
                kind=ExerciseKind(payload.kind),
                category=Category(payload.category),
                muscle_ids=tuple(payload.muscle_ids),
                secondary_muscle_ids=tuple(payload.secondary_muscle_ids),
                equipment_ids=tuple(payload.equipment_ids),
                is_active=payload.is_active,
            ),
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise _conflict() from error
    return _status(created, _detail(exercise))


@router.delete(
    "/custom-exercises/{exercise_id}/",
    response={204: None},
    summary="Supprimer un exercice perso inutilisé",
)
def remove_custom_exercise(request: HttpRequest, exercise_id: ClientId) -> Status[None]:
    try:
        services.delete_custom_exercise(owner=_writer(request), exercise_id=exercise_id)
    except services.ExerciseInUseError as error:
        raise ProblemError(
            409,
            "Exercice utilisé dans une séance ou un programme : archivez-le.",
            type_=IN_USE_TYPE,
        ) from error
    return Status(204, None)
