import hashlib
import logging
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import IntegrityError, models, transaction

from apps.accounts.models import User
from apps.accounts.selectors import get_one_rm_formula
from apps.accounts.services import lock_account

from . import repdb
from .cardio import CARDIO_EXERCISES, LEST_PREFIX
from .images import FORMAT_VERSION, ImageRejectedError, NormalizedImage, normalize
from .measures import COLUMNS, MEASURES, OPTIONAL, RECORDS, WORKING_TYPES
from .models import (
    MAX_CUSTOM_EXERCISES,
    Category,
    Equipment,
    Exercise,
    ExerciseImage,
    ExerciseKind,
    Muscle,
    NameLanguage,
    PersonalRecord,
    Program,
    ProgramDay,
    ProgramExercise,
    ProgramSet,
    RecordKind,
    Set,
    SetType,
    Workout,
    WorkoutExercise,
)
from .one_rep_max import estimate_one_rep_max

logger = logging.getLogger(__name__)


# Verrou d'exclusivité de l'import (cache partagé, Redis) : deux imports simultanés (commande
# et tâche, ou deux commandes) créeraient les mêmes images en même temps. Durée bornée : un
# import interrompu ne bloque pas le suivant indéfiniment.
IMPORT_LOCK = "training:import-exercises"
IMPORT_LOCK_SECONDS = 60 * 60


class ImportRunningError(Exception):
    """Un import du catalogue est déjà en cours."""


@contextmanager
def import_lock() -> Iterator[None]:
    """Exécute l'import seul, ou lève `ImportRunningError`. Le verrou n'est rendu que par celui
    qui le détient (jeton), même s'il a expiré entre-temps."""
    token = uuid4().hex
    if not cache.add(IMPORT_LOCK, token, IMPORT_LOCK_SECONDS):
        raise ImportRunningError
    try:
        yield
    finally:
        if cache.get(IMPORT_LOCK) == token:
            cache.delete(IMPORT_LOCK)


class EmptyCatalogError(Exception):
    """RepDB n'a renvoyé aucun exercice exploitable : rien n'est modifié (sinon tout le
    catalogue serait désactivé sur une réponse vide)."""


@dataclass(frozen=True)
class ImportReport:
    created: int
    updated: int
    deactivated: int


def _reference_data(
    exercises: Sequence[repdb.RepdbExercise],
) -> tuple[dict[str, Muscle], dict[str, Equipment]]:
    """Muscles et équipements cités par le catalogue, avec nos libellés français ; un code
    encore inconnu garde son code comme libellé, lisible."""
    muscle_codes = {
        code for item in exercises for code in item.muscle_codes + item.secondary_muscle_codes
    }
    equipment_codes = {code for item in exercises for code in item.equipment_codes}
    muscles: dict[str, Muscle] = {}
    for code in sorted(muscle_codes):
        name, is_front = repdb.MUSCLES.get(code, (code.replace("_", " ")[:60], True))
        muscles[code], _ = Muscle.objects.update_or_create(
            code=code, defaults={"name": name, "is_front": is_front}
        )
    equipment: dict[str, Equipment] = {}
    for code in sorted(equipment_codes):
        name = repdb.EQUIPMENT.get(code, code.replace("_", " ")[:60])
        equipment[code], _ = Equipment.objects.update_or_create(code=code, defaults={"name": name})
    return muscles, equipment


def _used_exercise_ids() -> set[UUID]:
    """Exercices présents dans une séance ou une séance type, tous comptes confondus."""
    in_workouts = WorkoutExercise.objects.values_list("exercise_id", flat=True)
    in_programs = ProgramExercise.objects.values_list("exercise_id", flat=True)
    return set(in_workouts.distinct()) | set(in_programs.distinct())


def import_exercises(*, exercises: Sequence[repdb.RepdbExercise]) -> ImportReport:
    """
    Met le catalogue à jour depuis RepDB (ADR 0006), en une transaction.

    Rejouable : la clé est l'identifiant RepDB. Un exercice qui n'est plus chez RepDB est
    désactivé, jamais supprimé : il peut figurer dans des séances. Lève `EmptyCatalogError` si
    aucun exercice n'est exploitable.
    """
    if not exercises:
        raise EmptyCatalogError
    created = updated = 0
    with transaction.atomic():
        muscles, equipment = _reference_data(exercises)
        # Le type d'un exercice déjà utilisé ne change plus : ses séries en dépendent (ADR 0017).
        used = _used_exercise_ids()
        for item in exercises:
            exercise, was_created = Exercise.objects.update_or_create(
                source_id=item.id,
                defaults={
                    "name": item.name,
                    "name_language": NameLanguage.ENGLISH,
                    "category": item.category,
                    "license": repdb.LICENSE,
                    "license_author": repdb.AUTHOR,
                    "is_active": True,
                },
                create_defaults={
                    "name": item.name,
                    "name_language": NameLanguage.ENGLISH,
                    "category": item.category,
                    "kind": item.kind,
                    "license": repdb.LICENSE,
                    "license_author": repdb.AUTHOR,
                    "is_active": True,
                },
            )
            if not was_created and exercise.pk not in used and exercise.kind != item.kind:
                exercise.kind = item.kind
                exercise.save(update_fields=["kind", "updated_at"])
            exercise.muscles.set([muscles[code] for code in item.muscle_codes])
            exercise.secondary_muscles.set([muscles[code] for code in item.secondary_muscle_codes])
            exercise.equipment.set([equipment[code] for code in item.equipment_codes])
            created += was_created
            updated += not was_created
        deactivated = (
            Exercise.objects.filter(source_id__isnull=False, is_active=True)
            .exclude(source_id__in=[item.id for item in exercises])
            .exclude(source_id__startswith=LEST_PREFIX)  # exercices de Lest, hors RepDB
            .update(is_active=False)
        )
    return ImportReport(created=created, updated=updated, deactivated=deactivated)


# --- Séances : écritures idempotentes (ADR 0003) -------------------------------------------


# Plafonds d'une séance (422 au-delà) : bornent aussi le coût du recalcul des records.
MAX_SETS_PER_EXERCISE = 100
MAX_EXERCISES_PER_WORKOUT = 50
ALL_KINDS = frozenset(RecordKind.values)


class NotFoundError(Exception):
    """Identifiant inconnu, ou d'un autre compte : l'API répond 404 dans les deux cas, sans
    rien écrire ni confirmer que l'identifiant existe."""


def _unknown(field: str) -> ValidationError:
    # Parent absent ou d'un autre compte : 422, la file hors ligne rejoue dans l'ordre (ADR 0003).
    return ValidationError({field: ValidationError("Inconnu.", code="unknown")})


def _too_many(field: str) -> ValidationError:
    return ValidationError({field: ValidationError("Plafond atteint.", code="too_many")})


class WriteConflictError(Exception):
    """Écriture refusée par la base pour une autre raison qu'un rejeu (409, sans détail : le
    message de Postgres reprendrait les valeurs de la série)."""


Resolver = Callable[[], dict[str, Any]]


def _locked[M: models.Model](model: type[M], pk: UUID) -> M | None:
    """Ligne `pk` verrouillée jusqu'à la fin de la transaction, ou `None`."""
    return model._default_manager.select_for_update().filter(pk=pk).first()


def _put[M: models.Model](
    model: type[M], *, pk: UUID, owned: models.Q, values: dict[str, Any], parents: Resolver
) -> tuple[M, bool]:
    """Crée ou remplace `model(pk)`. `owned` filtre les objets du compte : un objet existant
    hors de ce filtre lève `NotFoundError`. `parents` relit et verrouille les parents dans la
    même transaction (`_unknown` s'ils ont disparu) : une suppression concurrente ne peut pas
    laisser une clé étrangère orpheline. Valide le modèle avant d'écrire.

    Une seule nouvelle tentative sur `IntegrityError` : un second premier envoi simultané
    devient une mise à jour, un parent supprimé entre-temps devient un 422 ; toute autre
    violation est un `WriteConflictError`.
    """
    for attempt in range(2):
        try:
            with transaction.atomic():
                resolved = parents()
                existing = _locked(model, pk)
                if (
                    existing is not None
                    and not model._default_manager.filter(owned, pk=pk).exists()
                ):
                    raise NotFoundError
                instance = existing or model(pk=pk)
                for field, value in {**values, **resolved}.items():
                    setattr(instance, field, value)
                instance.full_clean(validate_unique=False)
                instance.save(force_insert=existing is None)
            return instance, existing is None
        except IntegrityError:
            if attempt == 0:
                continue
            raise WriteConflictError from None
    raise AssertionError  # pragma: no cover — la boucle revient ou lève


def _visible_exercise(owner: User, exercise_id: UUID) -> Exercise | None:
    """Exercice du catalogue, ou exercice perso de `owner` : celui d'un autre compte n'existe
    pas pour lui (ADR 0017)."""
    return (
        Exercise.objects.filter(pk=exercise_id)
        .filter(models.Q(owner__isnull=True) | models.Q(owner=owner))
        .first()
    )


# --- Exercices perso (ADR 0017) : `PUT` idempotent sur un UUID du client ----------------------


class ExerciseInUseError(Exception):
    """Exercice perso présent dans une séance ou une séance type : à archiver, pas à supprimer."""


@dataclass(frozen=True)
class CustomExerciseValues:
    name: str
    kind: ExerciseKind
    category: Category
    muscle_ids: tuple[int, ...] = ()
    secondary_muscle_ids: tuple[int, ...] = ()
    equipment_ids: tuple[int, ...] = ()
    is_active: bool = True


def _rows[M: models.Model](model: type[M], ids: tuple[int, ...], field: str) -> list[M]:
    rows = list(model._default_manager.filter(pk__in=ids))
    if len(rows) != len(set(ids)):
        raise _unknown(field)
    return rows


def put_custom_exercise(
    *, owner: User, exercise_id: UUID, values: CustomExerciseValues
) -> tuple[Exercise, bool]:
    """Crée ou remplace un exercice perso de `owner`. Un identifiant du catalogue ou d'un autre
    compte lève `NotFoundError`. Le type ne change plus une fois l'exercice utilisé (422
    `locked`). Au plus `MAX_CUSTOM_EXERCISES` par compte (422 `too_many`)."""
    with transaction.atomic():
        lock_account(owner)
        muscles = _rows(Muscle, values.muscle_ids, "muscle_ids")
        secondary = _rows(Muscle, values.secondary_muscle_ids, "secondary_muscle_ids")
        equipment = _rows(Equipment, values.equipment_ids, "equipment_ids")

        def parents() -> dict[str, Any]:
            existing = Exercise.objects.filter(pk=exercise_id, owner=owner).first()
            if existing is None:
                if Exercise.objects.filter(owner=owner).count() >= MAX_CUSTOM_EXERCISES:
                    raise _too_many("exercise_id")
            elif existing.kind != values.kind and existing.pk in _used_exercise_ids_of(owner):
                raise ValidationError(
                    {"kind": ValidationError("Type fixé par l'historique.", code="locked")}
                )
            return {"owner": owner}

        exercise, created = _put(
            Exercise,
            pk=exercise_id,
            owned=models.Q(owner=owner),
            values={
                "name": values.name,
                "name_language": NameLanguage.FRENCH,
                "kind": values.kind,
                "category": values.category,
                "license": "",
                "license_author": "",
                "is_active": values.is_active,
            },
            parents=parents,
        )
        exercise.muscles.set(muscles)
        exercise.secondary_muscles.set(secondary)
        exercise.equipment.set(equipment)
    return exercise, created


def _used_exercise_ids_of(owner: User) -> set[UUID]:
    in_workouts = WorkoutExercise.objects.filter(workout__owner=owner)
    in_programs = ProgramExercise.objects.filter(day__program__owner=owner)
    return set(in_workouts.values_list("exercise_id", flat=True)) | set(
        in_programs.values_list("exercise_id", flat=True)
    )


def delete_custom_exercise(*, owner: User, exercise_id: UUID) -> None:
    """Supprime un exercice perso de `owner` (idempotent ; sans effet sur le catalogue ou sur
    l'exercice d'un autre compte). Lève `ExerciseInUseError` s'il sert encore."""
    with transaction.atomic():
        lock_account(owner)
        exercise = Exercise.objects.filter(pk=exercise_id, owner=owner).first()
        if exercise is None:
            return
        if exercise.pk in _used_exercise_ids_of(owner):
            raise ExerciseInUseError
        exercise.delete()


def copied_exercise_id(workout_id: UUID, program_exercise_id: UUID) -> UUID:
    """Identifiant de l'exercice de séance recopié d'un exercice de programme : stable (même
    séance, même exercice de programme) et au format v4, le seul que l'API accepte en retour
    pour y ajouter des séries ou le retirer."""
    digest = hashlib.sha256(workout_id.bytes + program_exercise_id.bytes).digest()
    return UUID(bytes=digest[:16], version=4)


def _planned_row(one: ProgramSet) -> dict[str, Any]:
    """Série prévue telle que recopiée dans la séance (JSON : décimaux en texte)."""
    return {
        "set_type": one.set_type,
        "weight_kg": None if one.weight_kg is None else str(one.weight_kg),
        "reps": one.reps,
        "duration_s": one.duration_s,
        "distance_m": None if one.distance_m is None else str(one.distance_m),
    }


def _copied(workout: Workout, planned: ProgramExercise) -> WorkoutExercise:
    """Exercice de séance recopié de la routine : séries prévues, repos, superset, note, et la
    cible « séries x répétitions » qu'en tire l'écran actuel."""
    sets = list(planned.sets.all())
    working = [one for one in sets if one.set_type in WORKING_TYPES]
    reps = next((one.reps for one in working if one.reps is not None), None)
    return WorkoutExercise(
        id=copied_exercise_id(workout.pk, planned.pk),
        workout=workout,
        exercise_id=planned.exercise_id,
        position=planned.position,
        planned_sets=[_planned_row(one) for one in sets],
        target_sets=len(working) if working and reps is not None else None,
        target_reps=reps if working else None,
        rest_seconds=planned.rest_seconds,
        superset=planned.superset,
        note=planned.note,
    )


def put_workout(
    *,
    owner: User,
    workout_id: UUID,
    started_at: datetime,
    ended_at: datetime | None,
    program_day_id: UUID | None = None,
    details: dict[str, Any] | None = None,
) -> tuple[Workout, bool]:
    """Crée ou remplace une séance de `owner`. Renvoie la séance et `True` si elle est créée.

    `program_day_id` : séance type suivie, lue **à la création seulement** : ses exercices et
    leurs cibles sont alors recopiés dans la séance, sous des identifiants dérivés
    (`copied_exercise_id`) qu'un rejeu retrouve, sans doublon (ADR 0003). Ensuite, le champ est
    ignoré : une séance type supprimée depuis n'empêche pas de terminer la séance. À la
    création, une séance type inconnue ou d'un autre compte est refusée (422, sans dire
    laquelle des deux).

    `details` : nom, note, fréquence cardiaque, ressenti (ADR 0017), écrits seulement s'ils
    sont fournis. La file hors ligne renvoie la séance sans eux au démarrage et à la fin :
    elle ne doit pas effacer une note saisie entre-temps.
    """

    def parents() -> dict[str, Any]:
        if program_day_id is None or Workout.objects.filter(pk=workout_id).exists():
            return {}
        day = (
            ProgramDay.objects.select_for_update()
            .filter(pk=program_day_id, program__owner=owner)
            .first()
        )
        if day is None:
            raise _unknown("program_day_id")
        return {"program_day": day}

    with transaction.atomic():
        workout, created = _put(
            Workout,
            pk=workout_id,
            owned=models.Q(owner=owner),
            values={
                "owner": owner,
                "started_at": started_at,
                "ended_at": ended_at,
                **(details or {}),
            },
            parents=parents,
        )
        if created and workout.program_day_id is not None:
            if "name" not in (details or {}):
                # Nom de la séance type suivie, gardé même si elle est renommée ou supprimée.
                workout.name = ProgramDay.objects.get(pk=workout.program_day_id).name
                workout.save(update_fields=["name", "updated_at"])
            WorkoutExercise.objects.bulk_create(
                _copied(workout, planned)
                for planned in ProgramExercise.objects.filter(
                    day_id=workout.program_day_id
                ).prefetch_related("sets")
            )
    return workout, created


def put_workout_exercise(
    *,
    owner: User,
    workout_exercise_id: UUID,
    workout_id: UUID,
    exercise_id: UUID,
    position: int,
    details: dict[str, Any] | None = None,
) -> tuple[WorkoutExercise, bool]:
    """Crée ou remplace un exercice d'une séance de `owner`. Un exercice désactivé du
    catalogue reste accepté : une saisie hors ligne peut le rejouer après sa désactivation.
    `details` : repos, superset, note (ADR 0017), écrits seulement s'ils sont fournis."""

    def parents() -> dict[str, Any]:
        workout = Workout.objects.select_for_update().filter(pk=workout_id, owner=owner).first()
        if workout is None:
            raise _unknown("workout_id")
        others = workout.exercises.exclude(pk=workout_exercise_id).count()
        if others >= MAX_EXERCISES_PER_WORKOUT:
            raise _too_many("workout_id")
        exercise = _visible_exercise(owner, exercise_id)
        if exercise is None:
            raise _unknown("exercise_id")
        # Ses séries sont saisies pour un type : un exercice d'un autre type ne les reprend pas.
        # Lignes du compte seulement : celle d'un autre compte répond 404 (`_put`), jamais 422.
        with_sets = WorkoutExercise.objects.filter(
            pk=workout_exercise_id, workout__owner=owner, sets__isnull=False
        )
        if with_sets.exclude(exercise__kind=exercise.kind).exists():
            raise ValidationError(
                {"exercise_id": ValidationError("Type différent.", code="kind_mismatch")}
            )
        return {"workout": workout, "exercise": exercise}

    with transaction.atomic():
        before = _exercise_ids(WorkoutExercise.objects.filter(pk=workout_exercise_id), owner)
        item, created = _put(
            WorkoutExercise,
            pk=workout_exercise_id,
            owned=models.Q(workout__owner=owner),
            values={"position": position, **(details or {})},
            parents=parents,
        )
        # Exercice changé : ses séries comptent désormais pour l'autre exercice.
        _recompute(owner, before | {item.exercise_id})
    return item, created


@dataclass(frozen=True)
class SetValues:
    """Une série telle que saisie : seules les colonnes du type de l'exercice sont remplies."""

    position: int
    performed_at: datetime
    set_type: SetType = SetType.NORMAL
    weight_kg: Decimal | None = None
    reps: int | None = None
    duration_s: int | None = None
    distance_m: Decimal | None = None
    rpe: Decimal | None = None


def _check_measures(values: SetValues, kind: str) -> None:
    """Exige les colonnes du type `kind` (sauf `OPTIONAL`) et refuse les autres (422
    `required` ou `not_allowed`, sans les valeurs)."""
    expected = COLUMNS[kind]
    optional = OPTIONAL.get(kind, frozenset())
    errors: dict[str, ValidationError] = {}
    for column in MEASURES:
        filled = getattr(values, column) is not None
        if column in expected and column not in optional and not filled:
            errors[column] = ValidationError("Valeur attendue.", code="required")
        elif column not in expected and filled:
            errors[column] = ValidationError("Valeur hors du type.", code="not_allowed")
    if errors:
        raise ValidationError(errors)


def put_set(
    *, owner: User, set_id: UUID, workout_exercise_id: UUID, values: SetValues
) -> tuple[Set, bool]:
    """Crée ou remplace une série d'un exercice de séance de `owner`. Les mesures suivent le
    type de l'exercice (ADR 0017) : colonne manquante ou en trop, 422."""

    def parents() -> dict[str, Any]:
        workout_exercise = (
            WorkoutExercise.objects.select_for_update()
            .select_related("exercise")
            .filter(pk=workout_exercise_id, workout__owner=owner)
            .first()
        )
        if workout_exercise is None:
            raise _unknown("workout_exercise_id")
        if workout_exercise.sets.exclude(pk=set_id).count() >= MAX_SETS_PER_EXERCISE:
            raise _too_many("workout_exercise_id")
        _check_measures(values, workout_exercise.exercise.kind)
        return {"workout_exercise": workout_exercise}

    with transaction.atomic():
        before = _exercise_ids(Set.objects.filter(pk=set_id), owner, via="workout_exercise__")
        one, created = _put(
            Set,
            pk=set_id,
            owned=models.Q(workout_exercise__workout__owner=owner),
            values={
                "position": values.position,
                "set_type": values.set_type,
                "weight_kg": values.weight_kg,
                "reps": values.reps,
                "duration_s": values.duration_s,
                "distance_m": values.distance_m,
                "rpe": values.rpe,
                "performed_at": values.performed_at,
            },
            parents=parents,
        )
        _recompute(owner, before | {one.workout_exercise.exercise_id})
    return one, created


def delete_workout(*, owner: User, workout_id: UUID) -> None:
    """Supprime une séance de `owner` (et ses séries). Idempotent : sans effet si elle n'existe
    plus ou appartient à un autre compte. Records des exercices concernés recalculés."""
    with transaction.atomic():
        touched = _exercise_ids(WorkoutExercise.objects.filter(workout_id=workout_id), owner)
        Workout.objects.filter(pk=workout_id, owner=owner).delete()
        _recompute(owner, touched)


def delete_workout_exercise(*, owner: User, workout_exercise_id: UUID) -> None:
    """Supprime un exercice de séance de `owner` et ses séries. Idempotent."""
    with transaction.atomic():
        touched = _exercise_ids(WorkoutExercise.objects.filter(pk=workout_exercise_id), owner)
        WorkoutExercise.objects.filter(pk=workout_exercise_id, workout__owner=owner).delete()
        _recompute(owner, touched)


def delete_set(*, owner: User, set_id: UUID) -> None:
    """Supprime une série de `owner`. Idempotent."""
    with transaction.atomic():
        touched = _exercise_ids(Set.objects.filter(pk=set_id), owner, via="workout_exercise__")
        Set.objects.filter(pk=set_id, workout_exercise__workout__owner=owner).delete()
        _recompute(owner, touched)


# --- Programmes (dossiers) et séances types (routines, ADR 0017) -----------------------------

# Plafonds (422 au-delà) : un programme reste un carnet, pas un entrepôt.
MAX_PROGRAMS = 30
MAX_DAYS_PER_PROGRAM = 50
MAX_EXERCISES_PER_DAY = 20
MAX_PLANNED_SETS = 20


def put_program(*, owner: User, program_id: UUID, name: str) -> tuple[Program, bool]:
    """Crée ou renomme un programme de `owner`."""

    def parents() -> dict[str, Any]:
        # Verrou du compte : deux créations simultanées ne dépassent pas le plafond ensemble.
        lock_account(owner)
        if Program.objects.filter(owner=owner).exclude(pk=program_id).count() >= MAX_PROGRAMS:
            raise _too_many("program_id")
        return {}

    return _put(
        Program,
        pk=program_id,
        owned=models.Q(owner=owner),
        values={"owner": owner, "name": name},
        parents=parents,
    )


def put_program_day(
    *, owner: User, day_id: UUID, program_id: UUID, name: str, position: int
) -> tuple[ProgramDay, bool]:
    """Crée ou remplace une séance type d'un programme de `owner`."""

    def parents() -> dict[str, Any]:
        program = Program.objects.select_for_update().filter(pk=program_id, owner=owner).first()
        if program is None:
            raise _unknown("program_id")
        if program.days.exclude(pk=day_id).count() >= MAX_DAYS_PER_PROGRAM:
            raise _too_many("program_id")
        return {"program": program}

    return _put(
        ProgramDay,
        pk=day_id,
        owned=models.Q(program__owner=owner),
        values={"name": name, "position": position},
        parents=parents,
    )


def planned_set_id(program_exercise_id: UUID, position: int) -> UUID:
    """Identifiant d'une série prévue créée par le serveur (cible « N x R », mise à jour depuis
    une séance) : stable pour une même place, au format v4 (ADR 0003)."""
    digest = hashlib.sha256(program_exercise_id.bytes + position.to_bytes(2, "big")).digest()
    return UUID(bytes=digest[:16], version=4)


def _replace_planned_sets(planned: ProgramExercise, rows: list[dict[str, Any]]) -> None:
    """Remplace les séries prévues de `planned` par `rows` (colonnes d'une série), aux places
    0..n-1, sous des identifiants stables : rejouer donne les mêmes lignes."""
    planned.sets.all().delete()
    ProgramSet.objects.bulk_create(
        ProgramSet(
            id=planned_set_id(planned.pk, position),
            program_exercise=planned,
            position=position,
            **row,
        )
        for position, row in enumerate(rows[:MAX_PLANNED_SETS])
    )


def put_program_exercise(
    *,
    owner: User,
    program_exercise_id: UUID,
    day_id: UUID,
    exercise_id: UUID,
    position: int,
    details: dict[str, Any] | None = None,
    targets: tuple[int, int] | None = None,
) -> tuple[ProgramExercise, bool]:
    """Crée ou remplace un exercice d'une séance type de `owner`.

    `details` : repos, superset, note, écrits seulement s'ils sont fournis. `targets` (séries,
    répétitions) : raccourci de l'écran actuel des programmes, qui réécrit les séries prévues
    en N séries « normales » de R répétitions, en gardant leurs charges par place (transition,
    ADR 0017 : retiré avec la refonte de l'écran)."""

    def parents() -> dict[str, Any]:
        day = ProgramDay.objects.select_for_update().filter(pk=day_id, program__owner=owner).first()
        if day is None:
            raise _unknown("day_id")
        if day.exercises.exclude(pk=program_exercise_id).count() >= MAX_EXERCISES_PER_DAY:
            raise _too_many("day_id")
        exercise = _visible_exercise(owner, exercise_id)
        if exercise is None:
            raise _unknown("exercise_id")
        return {"day": day, "exercise": exercise}

    with transaction.atomic():
        planned, created = _put(
            ProgramExercise,
            pk=program_exercise_id,
            owned=models.Q(day__program__owner=owner),
            values={"position": position, **(details or {})},
            parents=parents,
        )
        if targets is not None:
            count, reps = targets
            loads = {one.position: one.weight_kg for one in planned.sets.all()}
            reps_column = "reps" in COLUMNS[planned.exercise.kind]
            _replace_planned_sets(
                planned,
                [
                    {
                        "set_type": SetType.NORMAL,
                        "weight_kg": loads.get(index),
                        "reps": reps if reps_column else None,
                    }
                    for index in range(count)
                ],
            )
    return planned, created


@dataclass(frozen=True)
class PlannedSetValues:
    """Série prévue : colonnes du type de l'exercice seulement, toutes facultatives."""

    position: int
    set_type: SetType = SetType.NORMAL
    weight_kg: Decimal | None = None
    reps: int | None = None
    duration_s: int | None = None
    distance_m: Decimal | None = None


def put_program_set(
    *, owner: User, set_id: UUID, program_exercise_id: UUID, values: PlannedSetValues
) -> tuple[ProgramSet, bool]:
    """Crée ou remplace une série prévue d'un exercice de routine de `owner`. Une colonne hors
    du type de l'exercice est refusée (422 `not_allowed`) ; au plus `MAX_PLANNED_SETS`."""

    def parents() -> dict[str, Any]:
        planned = (
            ProgramExercise.objects.select_for_update()
            .select_related("exercise")
            .filter(pk=program_exercise_id, day__program__owner=owner)
            .first()
        )
        if planned is None:
            raise _unknown("program_exercise_id")
        if planned.sets.exclude(pk=set_id).count() >= MAX_PLANNED_SETS:
            raise _too_many("program_exercise_id")
        allowed = COLUMNS[planned.exercise.kind]
        refused = {
            column: ValidationError("Valeur hors du type.", code="not_allowed")
            for column in MEASURES
            if column not in allowed and getattr(values, column) is not None
        }
        if refused:
            raise ValidationError(refused)
        return {"program_exercise": planned}

    return _put(
        ProgramSet,
        pk=set_id,
        owned=models.Q(program_exercise__day__program__owner=owner),
        values={
            "position": values.position,
            "set_type": values.set_type,
            "weight_kg": values.weight_kg,
            "reps": values.reps,
            "duration_s": values.duration_s,
            "distance_m": values.distance_m,
        },
        parents=parents,
    )


def delete_program_set(*, owner: User, set_id: UUID) -> None:
    """Supprime une série prévue de `owner`. Idempotent."""
    ProgramSet.objects.filter(pk=set_id, program_exercise__day__program__owner=owner).delete()


class NoRoutineError(Exception):
    """Séance faite hors routine, ou dont la routine a été supprimée depuis."""


def update_routine_from_workout(*, owner: User, workout_id: UUID) -> ProgramDay:
    """« Mettre à jour la routine » (ADR 0017) : les séries prévues de la séance type suivie
    deviennent les séries faites, exercice par exercice ; les exercices ajoutés pendant la
    séance s'ajoutent à la routine. Aucun exercice n'en est retiré. Rejouable : mêmes lignes,
    mêmes identifiants. Lève `NotFoundError` (séance inconnue ou d'un autre compte) ou
    `NoRoutineError`."""
    with transaction.atomic():
        workout = Workout.objects.filter(pk=workout_id, owner=owner).first()
        if workout is None:
            raise NotFoundError
        if workout.program_day_id is None:
            raise NoRoutineError
        day = (
            ProgramDay.objects.select_for_update()
            .filter(pk=workout.program_day_id, program__owner=owner)
            .first()
        )
        if day is None:
            raise NoRoutineError
        routine = {
            copied_exercise_id(workout.pk, planned.pk): planned
            for planned in day.exercises.select_related("exercise")
        }
        next_position = max((planned.position for planned in routine.values()), default=-1) + 1
        for item in workout.exercises.prefetch_related("sets").order_by("position", "created_at"):
            added_id = copied_exercise_id(day.pk, item.pk)
            # Recopié de la routine, ou ajouté par une mise à jour précédente (rejeu).
            planned = routine.get(item.pk) or day.exercises.filter(pk=added_id).first()
            if planned is None:
                if day.exercises.count() >= MAX_EXERCISES_PER_DAY:
                    continue
                planned = ProgramExercise.objects.create(
                    id=added_id,
                    day=day,
                    exercise_id=item.exercise_id,
                    position=next_position,
                    rest_seconds=item.rest_seconds,
                    superset=item.superset,
                )
                next_position += 1
            rows = [
                {
                    "set_type": one.set_type,
                    "weight_kg": one.weight_kg,
                    "reps": one.reps,
                    "duration_s": one.duration_s,
                    "distance_m": one.distance_m,
                }
                for one in item.sets.all()
            ]
            if rows:
                _replace_planned_sets(planned, rows)
    return day


def delete_program(*, owner: User, program_id: UUID) -> None:
    """Supprime un programme de `owner` et ses séances types. Idempotent. Les séances déjà
    faites restent, avec leurs cibles recopiées."""
    Program.objects.filter(pk=program_id, owner=owner).delete()


def delete_program_day(*, owner: User, day_id: UUID) -> None:
    """Supprime une séance type de `owner`. Idempotent."""
    ProgramDay.objects.filter(pk=day_id, program__owner=owner).delete()


def delete_program_exercise(*, owner: User, program_exercise_id: UUID) -> None:
    """Supprime un exercice d'une séance type de `owner`. Idempotent."""
    ProgramExercise.objects.filter(pk=program_exercise_id, day__program__owner=owner).delete()


# --- Records (CLAUDE.md : détectés à l'enregistrement d'une série, historisés) ---------------


def _exercise_ids(queryset: models.QuerySet[Any], owner: User, via: str = "") -> set[UUID]:
    """Exercices du catalogue touchés par `queryset` (exercices de séance, ou séries avec
    `via="workout_exercise__"`), limités aux données de `owner`."""
    return set(
        queryset.filter(**{f"{via}workout__owner": owner}).values_list(
            f"{via}exercise_id", flat=True
        )
    )


def _recompute(owner: User, exercise_ids: set[UUID], kinds: frozenset[str] = ALL_KINDS) -> None:
    """Records de ces exercices reconstruits, sous le verrou du compte : deux écritures
    simultanées (téléphone et ordinateur) ou un changement de formule se succèdent au lieu de
    mêler leurs records. Tous effacés d'abord : une série qui change d'exercice porte encore
    les records de l'ancien (un record par série et par type)."""
    lock_account(owner)
    PersonalRecord.objects.filter(
        owner=owner, exercise_id__in=exercise_ids, kind__in=kinds
    ).delete()
    formula = get_one_rm_formula(owner)
    for exercise_id in exercise_ids:
        PersonalRecord.objects.bulk_create(_build_records(owner, exercise_id, formula, kinds))


def _record_values(
    kind: str,
    weight_kg: Decimal | None,
    reps: int | None,
    duration_s: int | None,
    distance_m: Decimal | None,
    formula: str,
) -> dict[RecordKind, Decimal | None]:
    """Valeur de chaque record suivi pour le type `kind` (ADR 0017) ; `None` quand la série ne
    le mesure pas (charge nulle, aucune répétition…)."""
    load = weight_kg if weight_kg is not None and weight_kg > 0 else None
    lifted = load is not None and reps is not None and reps >= 1
    values: dict[RecordKind, Decimal | None] = {
        RecordKind.HEAVIEST: load,
        RecordKind.ESTIMATED_ONE_REP_MAX: None,
        RecordKind.SET_VOLUME: None,
        RecordKind.MOST_REPS: Decimal(reps) if reps else None,
        RecordKind.LONGEST_DURATION: Decimal(duration_s) if duration_s else None,
        RecordKind.LONGEST_DISTANCE: distance_m if distance_m else None,
    }
    if load is not None and reps is not None and lifted:
        values[RecordKind.ESTIMATED_ONE_REP_MAX] = estimate_one_rep_max(load, reps, formula)
        values[RecordKind.SET_VOLUME] = load * reps
    elif kind != ExerciseKind.WEIGHT_DISTANCE:
        # Une charge sans répétition n'a rien soulevé (la marche du fermier se mesure en distance).
        values[RecordKind.HEAVIEST] = None
    return {record: values[record] for record in RECORDS[kind]}


def _build_records(
    owner: User, exercise_id: UUID, formula: str, kinds: frozenset[str]
) -> list[PersonalRecord]:
    """
    Historique des records de `owner` pour un exercice, depuis ses séries.

    Recalculé, jamais incrémenté (ADR 0003) : une série modifiée, supprimée ou rejouée donne
    toujours le même historique. Séries de travail seulement, records suivis selon le type de
    l'exercice (`measures.RECORDS`), dans l'ordre où elles ont été faites ; un record n'est
    battu que strictement.
    """
    exercise_kind = Exercise.objects.filter(pk=exercise_id).values_list("kind", flat=True).first()
    if exercise_kind is None:
        return []
    sets = (
        Set.objects.filter(
            workout_exercise__workout__owner=owner,
            workout_exercise__exercise_id=exercise_id,
            set_type__in=WORKING_TYPES,
        )
        .order_by("performed_at", "id")
        .values_list("id", "weight_kg", "reps", "duration_s", "distance_m", "performed_at")
    )
    best: dict[str, Decimal] = {}
    records: list[PersonalRecord] = []
    for set_id, weight_kg, reps, duration_s, distance_m, performed_at in sets.iterator():
        values = _record_values(exercise_kind, weight_kg, reps, duration_s, distance_m, formula)
        for kind, value in values.items():
            if kind in kinds and value is not None and value > best.get(kind, Decimal(0)):
                best[kind] = value
                records.append(
                    PersonalRecord(
                        owner=owner,
                        exercise_id=exercise_id,
                        kind=kind,
                        value=value,
                        set_id=set_id,
                        achieved_at=performed_at,
                    )
                )
    return records


def recompute_all_records(*, owner: User) -> None:
    """1RM estimés de `owner`, pour tous ses exercices (la formule a changé). La charge
    maximale ne dépend pas de la formule : ses records ne sont pas touchés."""
    exercise_ids = set(
        WorkoutExercise.objects.filter(workout__owner=owner).values_list("exercise_id", flat=True)
    )
    with transaction.atomic():
        _recompute(owner, exercise_ids, kinds=frozenset({RecordKind.ESTIMATED_ONE_REP_MAX}))


# --- Séances de cardio (ADR 0017) -------------------------------------------------------------


@dataclass(frozen=True)
class CardioValues:
    """Séance terminée d'un seul exercice de cardio de Lest (`training.cardio`, par sa clé)."""

    sport: str
    started_at: datetime
    duration_s: int
    distance_m: Decimal | None = None
    avg_heart_rate: int | None = None
    feeling: int | None = None
    note: str | None = None


def cardio_part_id(workout_id: UUID, role: str) -> UUID:
    """Identifiant de l'exercice (`exercise`) ou de la série (`set`) d'une séance de cardio :
    dérivé de celui de la séance, au format v4 (ADR 0003)."""
    digest = hashlib.sha256(workout_id.bytes + role.encode()).digest()
    return UUID(bytes=digest[:16], version=4)


def put_cardio_workout(
    *, owner: User, workout_id: UUID, values: CardioValues
) -> tuple[Workout, bool]:
    """Crée ou remplace une séance de cardio terminée de `owner` : l'exercice de Lest du sport,
    une série de durée (et de distance si le sport en a). Rejouable : mêmes identifiants. Sert
    au seed de démo ; la saisie de l'app passe par les routes de séance."""
    kinds = {item.key: item.kind for item in CARDIO_EXERCISES}
    exercise = Exercise.objects.get(source_id=f"{LEST_PREFIX}{values.sport}", owner__isnull=True)
    ended = values.started_at + timedelta(seconds=values.duration_s)
    exercise_id = cardio_part_id(workout_id, "exercise")
    with transaction.atomic():
        workout, created = put_workout(
            owner=owner,
            workout_id=workout_id,
            started_at=values.started_at,
            ended_at=ended,
            details={
                "name": exercise.name,
                "avg_heart_rate": values.avg_heart_rate,
                "feeling": values.feeling,
            },
        )
        put_workout_exercise(
            owner=owner,
            workout_exercise_id=exercise_id,
            workout_id=workout_id,
            exercise_id=exercise.pk,
            position=0,
            details={"note": values.note},
        )
        put_set(
            owner=owner,
            set_id=cardio_part_id(workout_id, "set"),
            workout_exercise_id=exercise_id,
            values=SetValues(
                position=0,
                performed_at=ended,
                duration_s=values.duration_s,
                distance_m=values.distance_m if kinds[values.sport] != "duration" else None,
            ),
        )
    return workout, created


def rebuild_records(*, owner: User) -> int:
    """Tous les records de `owner`, reconstruits depuis ses séries (nouveaux types de record,
    ADR 0017). Rejouable ; renvoie le nombre de records."""
    exercise_ids = set(
        WorkoutExercise.objects.filter(workout__owner=owner).values_list("exercise_id", flat=True)
    )
    with transaction.atomic():
        _recompute(owner, exercise_ids)
    return PersonalRecord.objects.filter(owner=owner).count()


# --- Images du catalogue (ADR 0006) -----------------------------------------------------------


@dataclass(frozen=True)
class ImageImportReport:
    imported: int
    unchanged: int
    removed: int
    failed: int


def import_images(
    *, exercises: Sequence[repdb.RepdbExercise], fetch: Callable[[str], bytes]
) -> ImageImportReport:
    """
    Met à jour les images des exercices du catalogue, après `import_exercises`.

    Une image connue (même exercice et position, même source, même version de rendu, fichier
    intact) n'est pas retéléchargée. Une image injoignable ou illisible est comptée en échec et
    l'import continue. Les images que RepDB ne liste plus sont supprimées, fichier compris.
    `fetch` lit les octets d'un chemin RepDB (`repdb.fetch_image`, ou un double en test).
    """
    known = {(image.exercise_id, image.pose): image for image in ExerciseImage.objects.all()}
    by_source = {
        exercise.source_id: exercise
        for exercise in Exercise.objects.filter(source_id__in=[item.id for item in exercises])
    }
    listed: set[tuple[UUID, str]] = set()
    imported = unchanged = failed = 0
    for item in exercises:
        exercise = by_source.get(item.id)
        if exercise is None:  # catalogue pas encore importé pour cet exercice
            continue
        for source in item.images:
            key = (exercise.pk, source.pose)
            listed.add(key)
            current = known.get(key)
            if (
                current is not None
                and current.source_url == source.path
                and current.format_version == FORMAT_VERSION
                and default_storage.exists(current.file.name or "")
            ):
                unchanged += 1
                continue
            try:
                normalized = normalize(fetch(source.path))
            except (repdb.RepdbError, ImageRejectedError) as error:
                # Ni chemin ni contenu dans le journal : l'exercice et la position suffisent.
                logger.warning(
                    "Image RepDB %s/%s ignorée : %s", item.id, source.pose, type(error).__name__
                )
                failed += 1
                continue
            _store_image(current, exercise, source, normalized)
            imported += 1
    stale = [image for key, image in known.items() if key not in listed]
    for image in stale:
        _delete_image(image)
    return ImageImportReport(
        imported=imported, unchanged=unchanged, removed=len(stale), failed=failed
    )


def _store_image(
    current: ExerciseImage | None,
    exercise: Exercise,
    source: repdb.RepdbImage,
    normalized: NormalizedImage,
) -> None:
    image = current or ExerciseImage(exercise=exercise, pose=source.pose)
    previous = image.file.name if current else None
    image.position = repdb.POSES.index(source.pose)
    image.source_url = source.path
    image.digest = normalized.digest
    image.format_version = FORMAT_VERSION
    image.license = repdb.LICENSE
    image.license_author = repdb.AUTHOR
    name = f"exercises/{normalized.digest}.webp"
    with transaction.atomic():
        if not _stored_intact(name, normalized.digest):
            # Fichier absent, ou abîmé (écriture interrompue) : servi un an sinon, cache immuable.
            default_storage.delete(name)
            default_storage.save(name, ContentFile(normalized.content))
        image.file.name = name
        image.save()
    if previous and previous != name:
        _delete_file_if_unused(previous)


def _stored_intact(name: str, digest: str) -> bool:
    if not default_storage.exists(name):
        return False
    with default_storage.open(name) as stored:
        return hashlib.sha256(stored.read()).hexdigest() == digest


def _delete_image(image: ExerciseImage) -> None:
    name = image.file.name
    image.delete()
    if name:
        _delete_file_if_unused(name)


def _delete_file_if_unused(name: str) -> None:
    # Plusieurs images identiques partagent un fichier (même empreinte).
    if not ExerciseImage.objects.filter(file=name).exists():
        default_storage.delete(name)
