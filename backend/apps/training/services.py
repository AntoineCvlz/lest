from collections.abc import Sequence
from dataclasses import dataclass

from django.db import transaction

from . import wger
from .models import Equipment, Exercise, Muscle, NameLanguage


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
