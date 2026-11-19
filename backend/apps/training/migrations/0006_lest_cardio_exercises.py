"""Exercices de cardio de Lest (ADR 0017), un par sport de l'ancien catalogue des activités.
Rejouable : retrouvés par leur `source_id`, nom et type remis à jour."""

from typing import Any

from django.db import migrations

from apps.training.cardio import CARDIO_EXERCISES


def create_cardio_exercises(apps: Any, schema_editor: Any) -> None:
    exercise_model = apps.get_model("training", "Exercise")
    for item in CARDIO_EXERCISES:
        exercise_model.objects.update_or_create(
            source_id=item.source_id,
            defaults={
                "name": item.name,
                "name_language": "fr",
                "category": "cardio",
                "kind": item.kind,
                "license": "",
                "license_author": "",
                "is_active": True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("training", "0005_routine_planned_sets")]

    # Retour en arrière : les exercices restent (ils peuvent servir dans des séances).
    operations = [migrations.RunPython(create_cardio_exercises, migrations.RunPython.noop)]
