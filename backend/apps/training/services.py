from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction

from apps.accounts.models import User

from . import wger
from .models import Equipment, Exercise, Muscle, NameLanguage, Set, Workout, WorkoutExercise


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


class NotFoundError(Exception):
    """Identifiant inconnu, ou d'un autre compte : l'API répond 404 dans les deux cas, sans
    rien écrire ni confirmer que l'identifiant existe."""


def _unknown(field: str) -> ValidationError:
    # Parent absent ou d'un autre compte : 422, la file hors ligne rejoue dans l'ordre (ADR 0003).
    return ValidationError({field: ValidationError("Inconnu.", code="unknown")})


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
        exercise = Exercise.objects.filter(pk=exercise_id).first()
        if exercise is None:
            raise _unknown("exercise_id")
        return {"workout": workout, "exercise": exercise}

    return _put(
        WorkoutExercise,
        pk=workout_exercise_id,
        owned=models.Q(workout__owner=owner),
        values={"position": position},
        parents=parents,
    )


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
        return {"workout_exercise": workout_exercise}

    return _put(
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


def delete_workout(*, owner: User, workout_id: UUID) -> None:
    """Supprime une séance de `owner` (et ses séries). Idempotent : sans effet si elle n'existe
    plus ou appartient à un autre compte."""
    Workout.objects.filter(pk=workout_id, owner=owner).delete()


def delete_workout_exercise(*, owner: User, workout_exercise_id: UUID) -> None:
    """Supprime un exercice de séance de `owner` et ses séries. Idempotent."""
    WorkoutExercise.objects.filter(pk=workout_exercise_id, workout__owner=owner).delete()


def delete_set(*, owner: User, set_id: UUID) -> None:
    """Supprime une série de `owner`. Idempotent."""
    Set.objects.filter(pk=set_id, workout_exercise__workout__owner=owner).delete()
