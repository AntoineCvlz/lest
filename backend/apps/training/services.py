import hashlib
import logging
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
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
from .images import FORMAT_VERSION, ImageRejectedError, NormalizedImage, normalize
from .models import (
    Equipment,
    Exercise,
    ExerciseImage,
    Muscle,
    NameLanguage,
    PersonalRecord,
    Program,
    ProgramDay,
    ProgramExercise,
    RecordKind,
    Set,
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
            )
            exercise.muscles.set([muscles[code] for code in item.muscle_codes])
            exercise.secondary_muscles.set([muscles[code] for code in item.secondary_muscle_codes])
            exercise.equipment.set([equipment[code] for code in item.equipment_codes])
            created += was_created
            updated += not was_created
        deactivated = (
            Exercise.objects.filter(source_id__isnull=False, is_active=True)
            .exclude(source_id__in=[item.id for item in exercises])
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


def copied_exercise_id(workout_id: UUID, program_exercise_id: UUID) -> UUID:
    """Identifiant de l'exercice de séance recopié d'un exercice de programme : stable (même
    séance, même exercice de programme) et au format v4, le seul que l'API accepte en retour
    pour y ajouter des séries ou le retirer."""
    digest = hashlib.sha256(workout_id.bytes + program_exercise_id.bytes).digest()
    return UUID(bytes=digest[:16], version=4)


def put_workout(
    *,
    owner: User,
    workout_id: UUID,
    started_at: datetime,
    ended_at: datetime | None,
    program_day_id: UUID | None = None,
) -> tuple[Workout, bool]:
    """Crée ou remplace une séance de `owner`. Renvoie la séance et `True` si elle est créée.

    `program_day_id` : séance type suivie, lue **à la création seulement** : ses exercices et
    leurs cibles sont alors recopiés dans la séance, sous des identifiants dérivés
    (`copied_exercise_id`) qu'un rejeu retrouve, sans doublon (ADR 0003). Ensuite, le champ est
    ignoré : une séance type supprimée depuis n'empêche pas de terminer la séance. À la
    création, une séance type inconnue ou d'un autre compte est refusée (422, sans dire
    laquelle des deux).
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
            values={"owner": owner, "started_at": started_at, "ended_at": ended_at},
            parents=parents,
        )
        if created and workout.program_day_id is not None:
            WorkoutExercise.objects.bulk_create(
                WorkoutExercise(
                    id=copied_exercise_id(workout.pk, planned.pk),
                    workout=workout,
                    exercise_id=planned.exercise_id,
                    position=planned.position,
                    target_sets=planned.target_sets,
                    target_reps=planned.target_reps,
                )
                for planned in ProgramExercise.objects.filter(day_id=workout.program_day_id)
            )
    return workout, created


def put_workout_exercise(
    *, owner: User, workout_exercise_id: UUID, workout_id: UUID, exercise_id: UUID, position: int
) -> tuple[WorkoutExercise, bool]:
    """Crée ou remplace un exercice d'une séance de `owner`. Un exercice désactivé du
    catalogue reste accepté : une saisie hors ligne peut le rejouer après sa désactivation."""

    def parents() -> dict[str, Any]:
        workout = Workout.objects.select_for_update().filter(pk=workout_id, owner=owner).first()
        if workout is None:
            raise _unknown("workout_id")
        others = workout.exercises.exclude(pk=workout_exercise_id).count()
        if others >= MAX_EXERCISES_PER_WORKOUT:
            raise _too_many("workout_id")
        exercise = Exercise.objects.filter(pk=exercise_id).first()
        if exercise is None:
            raise _unknown("exercise_id")
        return {"workout": workout, "exercise": exercise}

    with transaction.atomic():
        before = _exercise_ids(WorkoutExercise.objects.filter(pk=workout_exercise_id), owner)
        item, created = _put(
            WorkoutExercise,
            pk=workout_exercise_id,
            owned=models.Q(workout__owner=owner),
            values={"position": position},
            parents=parents,
        )
        # Exercice changé : ses séries comptent désormais pour l'autre exercice.
        _recompute(owner, before | {item.exercise_id})
    return item, created


def put_set(
    *,
    owner: User,
    set_id: UUID,
    workout_exercise_id: UUID,
    position: int,
    weight_kg: Decimal,
    reps: int,
    rpe: Decimal | None,
    is_warmup: bool,
    performed_at: datetime,
) -> tuple[Set, bool]:
    """Crée ou remplace une série d'un exercice de séance de `owner`."""

    def parents() -> dict[str, Any]:
        workout_exercise = (
            WorkoutExercise.objects.select_for_update()
            .filter(pk=workout_exercise_id, workout__owner=owner)
            .first()
        )
        if workout_exercise is None:
            raise _unknown("workout_exercise_id")
        if workout_exercise.sets.exclude(pk=set_id).count() >= MAX_SETS_PER_EXERCISE:
            raise _too_many("workout_exercise_id")
        return {"workout_exercise": workout_exercise}

    with transaction.atomic():
        before = _exercise_ids(Set.objects.filter(pk=set_id), owner, via="workout_exercise__")
        one, created = _put(
            Set,
            pk=set_id,
            owned=models.Q(workout_exercise__workout__owner=owner),
            values={
                "position": position,
                "weight_kg": weight_kg,
                "reps": reps,
                "rpe": rpe,
                "is_warmup": is_warmup,
                "performed_at": performed_at,
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


# --- Programmes : séances types et cibles ---------------------------------------------------

# Plafonds (422 au-delà) : un programme reste un carnet, pas un entrepôt.
MAX_PROGRAMS = 30
MAX_DAYS_PER_PROGRAM = 7
MAX_EXERCISES_PER_DAY = 20


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


def put_program_exercise(
    *,
    owner: User,
    program_exercise_id: UUID,
    day_id: UUID,
    exercise_id: UUID,
    position: int,
    target_sets: int,
    target_reps: int,
) -> tuple[ProgramExercise, bool]:
    """Crée ou remplace un exercice d'une séance type de `owner`, avec sa cible."""

    def parents() -> dict[str, Any]:
        day = ProgramDay.objects.select_for_update().filter(pk=day_id, program__owner=owner).first()
        if day is None:
            raise _unknown("day_id")
        if day.exercises.exclude(pk=program_exercise_id).count() >= MAX_EXERCISES_PER_DAY:
            raise _too_many("day_id")
        exercise = Exercise.objects.filter(pk=exercise_id).first()
        if exercise is None:
            raise _unknown("exercise_id")
        return {"day": day, "exercise": exercise}

    return _put(
        ProgramExercise,
        pk=program_exercise_id,
        owned=models.Q(day__program__owner=owner),
        values={"position": position, "target_sets": target_sets, "target_reps": target_reps},
        parents=parents,
    )


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


def _build_records(
    owner: User, exercise_id: UUID, formula: str, kinds: frozenset[str]
) -> list[PersonalRecord]:
    """
    Historique des records de `owner` pour un exercice, depuis ses séries.

    Recalculé, jamais incrémenté (ADR 0003) : une série modifiée, supprimée ou rejouée donne
    toujours le même historique. Séries de travail seulement, d'au moins une répétition et
    avec charge, dans l'ordre où elles ont été faites ; un record n'est battu que strictement.
    """
    sets = (
        Set.objects.filter(
            workout_exercise__workout__owner=owner,
            workout_exercise__exercise_id=exercise_id,
            is_warmup=False,
            reps__gte=1,
            weight_kg__gt=0,
        )
        .order_by("performed_at", "id")
        .values_list("id", "weight_kg", "reps", "performed_at")
    )
    best: dict[str, Decimal] = {}
    records: list[PersonalRecord] = []
    for set_id, weight_kg, reps, performed_at in sets.iterator():
        values = {
            RecordKind.HEAVIEST: weight_kg,
            RecordKind.ESTIMATED_ONE_REP_MAX: estimate_one_rep_max(weight_kg, reps, formula),
        }
        for kind, value in values.items():
            if kind in kinds and value is not None and value > best.get(kind, Decimal(0)):
                best[kind] = value
                records.append(
                    PersonalRecord(
                        owner=owner,
                        exercise_id=exercise_id,
                        kind=kind,
                        value_kg=value,
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
