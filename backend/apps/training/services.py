import hashlib
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import IntegrityError, models, transaction

from apps.accounts.models import User
from apps.accounts.selectors import get_one_rm_formula
from apps.accounts.services import lock_account

from . import wger
from .images import FORMAT_VERSION, ImageRejectedError, NormalizedImage, normalize
from .models import (
    Equipment,
    Exercise,
    ExerciseImage,
    Muscle,
    NameLanguage,
    PersonalRecord,
    RecordKind,
    Set,
    Workout,
    WorkoutExercise,
)
from .one_rep_max import estimate_one_rep_max

logger = logging.getLogger(__name__)


class EmptyCatalogError(Exception):
    """wger n'a renvoyé aucun exercice exploitable : rien n'est modifié (sinon tout le
    catalogue serait désactivé sur une réponse vide)."""


@dataclass(frozen=True)
class ImportReport:
    created: int
    updated: int
    deactivated: int
    skipped: int


def sync_reference_data() -> None:
    """Muscles et équipements de wger, avec leurs libellés français (`wger.MUSCLES`…)."""
    for wger_id, (name, is_front) in wger.MUSCLES.items():
        Muscle.objects.update_or_create(
            wger_id=wger_id, defaults={"name": name, "is_front": is_front}
        )
    for wger_id, name in wger.EQUIPMENT.items():
        Equipment.objects.update_or_create(wger_id=wger_id, defaults={"name": name})


def import_wger_exercises(*, exercises: Sequence[wger.WgerExercise]) -> ImportReport:
    """
    Met le catalogue à jour depuis wger (ADR 0004), en une transaction.

    Rejouable : la clé est l'`uuid` de wger. Un exercice est ignoré si sa licence n'est pas
    acceptée (`wger.LICENSES`), s'il n'a ni nom français ni nom anglais, ou si sa catégorie est
    inconnue. Un exercice qui n'est plus chez wger est désactivé, jamais supprimé : il peut
    figurer dans des séances. Lève `EmptyCatalogError` si aucun exercice n'est exploitable.
    """
    usable = [(item, named) for item in exercises if (named := _usable_name(item))]
    if not usable:
        raise EmptyCatalogError
    created = updated = 0
    with transaction.atomic():
        sync_reference_data()
        muscles = {m.wger_id: m for m in Muscle.objects.all()}
        equipment = {e.wger_id: e for e in Equipment.objects.filter(wger_id__isnull=False)}
        for item, (name, language) in usable:
            exercise, was_created = Exercise.objects.update_or_create(
                wger_uuid=item.uuid,
                defaults={
                    "name": name,
                    "name_language": language,
                    "category": wger.CATEGORIES[item.category_id],
                    "license": item.license,
                    "license_author": item.license_author[:200],
                    "source_updated_at": item.updated_at,
                    "is_active": True,
                },
            )
            exercise.muscles.set([muscles[i] for i in item.muscle_ids if i in muscles])
            exercise.secondary_muscles.set(
                [muscles[i] for i in item.secondary_muscle_ids if i in muscles]
            )
            exercise.equipment.set([equipment[i] for i in item.equipment_ids if i in equipment])
            created += was_created
            updated += not was_created
        deactivated = (
            Exercise.objects.filter(wger_uuid__isnull=False, is_active=True)
            .exclude(wger_uuid__in=[item.uuid for item, _ in usable])
            .update(is_active=False)
        )
    return ImportReport(
        created=created,
        updated=updated,
        deactivated=deactivated,
        skipped=len(exercises) - len(usable),
    )


def _usable_name(item: wger.WgerExercise) -> tuple[str, NameLanguage] | None:
    """Nom affiché et sa langue (français, sinon anglais), ou `None` si l'exercice est ignoré."""
    if item.license not in wger.LICENSES or item.category_id not in wger.CATEGORIES:
        return None
    if item.name_fr:
        return item.name_fr[:200], NameLanguage.FRENCH
    if item.name_en:
        return item.name_en[:200], NameLanguage.ENGLISH
    return None


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


def _no_parent() -> dict[str, Any]:
    return {}


def put_workout(
    *, owner: User, workout_id: UUID, started_at: datetime, ended_at: datetime | None
) -> tuple[Workout, bool]:
    """Crée ou remplace une séance de `owner`. Renvoie la séance et `True` si elle est créée."""
    return _put(
        Workout,
        pk=workout_id,
        owned=models.Q(owner=owner),
        values={"owner": owner, "started_at": started_at, "ended_at": ended_at},
        parents=_no_parent,
    )


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


# --- Images du catalogue (ADR 0005) -----------------------------------------------------------


@dataclass(frozen=True)
class ImageImportReport:
    imported: int
    unchanged: int
    removed: int
    failed: int


def import_wger_images(
    *, exercises: Sequence[wger.WgerExercise], fetch: Callable[[str], bytes]
) -> ImageImportReport:
    """
    Met à jour les images des exercices du catalogue, après `import_wger_exercises`.

    Une image connue (même `uuid` wger, même URL source, même version de rendu) n'est pas
    retéléchargée. Une image
    injoignable ou illisible est comptée en échec et l'import continue : une image manquante
    n'empêche pas d'utiliser l'exercice. Les images que wger ne liste plus sont supprimées,
    fichier compris. `fetch` lit les octets d'une URL (`wger.fetch_image`, ou un double en test).
    """
    known = {image.wger_uuid: image for image in ExerciseImage.objects.all()}
    by_uuid = {
        exercise.wger_uuid: exercise
        for exercise in Exercise.objects.filter(wger_uuid__in=[item.uuid for item in exercises])
    }
    listed: set[UUID] = set()
    imported = unchanged = failed = 0
    for item in exercises:
        exercise = by_uuid.get(item.uuid)
        if exercise is None:  # exercice ignoré par l'import du catalogue (licence, catégorie)
            continue
        for position, source in enumerate(item.images):
            listed.add(source.uuid)
            current = known.get(source.uuid)
            if (
                current is not None
                and current.source_url == source.url
                and current.format_version == FORMAT_VERSION
                and default_storage.exists(current.file.name or "")
            ):
                _update_image(current, exercise, source, position)
                unchanged += 1
                continue
            try:
                normalized = normalize(fetch(source.url))
            except (wger.WgerError, ImageRejectedError) as error:
                # Ni URL ni contenu dans le journal : l'identifiant suffit à retrouver l'image.
                logger.warning("Image wger %s ignorée : %s", source.uuid, type(error).__name__)
                failed += 1
                continue
            _store_image(current, exercise, source, position, normalized)
            imported += 1
    stale = [image for uuid, image in known.items() if uuid not in listed]
    for image in stale:
        _delete_image(image)
    return ImageImportReport(
        imported=imported, unchanged=unchanged, removed=len(stale), failed=failed
    )


def _update_image(
    image: ExerciseImage, exercise: Exercise, source: wger.WgerImage, position: int
) -> None:
    _update_fields(image, exercise, source, position)
    image.save(update_fields=["exercise", "is_main", "position", "license", "license_author"])


def _store_image(
    current: ExerciseImage | None,
    exercise: Exercise,
    source: wger.WgerImage,
    position: int,
    normalized: NormalizedImage,
) -> None:
    image = current or ExerciseImage(wger_uuid=source.uuid)
    previous = image.file.name if current else None
    image.source_url = source.url
    image.digest = normalized.digest
    image.format_version = FORMAT_VERSION
    with transaction.atomic():
        _update_fields(image, exercise, source, position)
        name = f"exercises/{normalized.digest}.webp"
        if not _stored_intact(name, normalized.digest):
            # Fichier absent, ou abîmé (écriture interrompue) : servi un an sinon, cache immuable.
            default_storage.delete(name)
            default_storage.save(name, ContentFile(normalized.content))
        image.file.name = name
        image.save()
    if previous and previous != name:
        _delete_file_if_unused(previous)


def _update_fields(
    image: ExerciseImage, exercise: Exercise, source: wger.WgerImage, position: int
) -> None:
    image.exercise = exercise
    image.is_main = source.is_main
    image.position = position
    image.license = source.license
    image.license_author = source.license_author


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
