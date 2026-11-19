"""Séries : types de série et mesures facultatives selon le type d'exercice ; records élargis
(ADR 0017).

Ordre qui garde les données : `set_type` est rempli depuis `is_warmup` avant la suppression de
celui-ci, et `value_kg` est renommé en `value` (jamais supprimé puis recréé).
"""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor


def warmups_to_set_type(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    sets = apps.get_model("training", "Set").objects
    sets.filter(is_warmup=True).update(set_type="warmup")


def set_type_to_warmups(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    sets = apps.get_model("training", "Set").objects
    sets.filter(set_type="warmup").update(is_warmup=True)


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0002_exercise_kind_and_owner"),
    ]

    operations = [
        # Types de série.
        migrations.AddField(
            model_name="set",
            name="set_type",
            field=models.CharField(
                choices=[
                    ("warmup", "Échauffement"),
                    ("normal", "Normale"),
                    ("drop", "Dégressive"),
                    ("failure", "À l'échec"),
                ],
                default="normal",
                max_length=8,
            ),
        ),
        migrations.RunPython(warmups_to_set_type, set_type_to_warmups),
        migrations.RemoveField(model_name="set", name="is_warmup"),
        # Mesures facultatives.
        migrations.RemoveConstraint(model_name="set", name="training_set_weight_range"),
        migrations.RemoveConstraint(model_name="set", name="training_set_reps_range"),
        migrations.AlterField(
            model_name="set",
            name="weight_kg",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True),
        ),
        migrations.AlterField(
            model_name="set",
            name="reps",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="set",
            name="duration_s",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="set",
            name="distance_m",
            field=models.DecimalField(blank=True, decimal_places=1, max_digits=8, null=True),
        ),
        migrations.AddConstraint(
            model_name="set",
            constraint=models.CheckConstraint(
                condition=models.Q(weight_kg__isnull=True)
                | models.Q(weight_kg__gte=0, weight_kg__lte=1000),
                name="training_set_weight_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="set",
            constraint=models.CheckConstraint(
                condition=models.Q(reps__isnull=True) | models.Q(reps__lte=1000),
                name="training_set_reps_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="set",
            constraint=models.CheckConstraint(
                condition=models.Q(duration_s__isnull=True) | models.Q(duration_s__lte=86400),
                name="training_set_duration_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="set",
            constraint=models.CheckConstraint(
                condition=models.Q(distance_m__isnull=True)
                | models.Q(distance_m__gte=0, distance_m__lte=1000000),
                name="training_set_distance_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="set",
            constraint=models.CheckConstraint(
                condition=models.Q(reps__isnull=False)
                | models.Q(duration_s__isnull=False)
                | models.Q(distance_m__isnull=False),
                name="training_set_measured",
            ),
        ),
        migrations.AddConstraint(
            model_name="set",
            constraint=models.CheckConstraint(
                condition=models.Q(set_type__in=["warmup", "normal", "drop", "failure"]),
                name="training_set_type_valid",
            ),
        ),
        # Records : valeur générique et nouveaux types.
        migrations.RenameField(model_name="personalrecord", old_name="value_kg", new_name="value"),
        migrations.AlterField(
            model_name="personalrecord",
            name="value",
            field=models.DecimalField(decimal_places=2, max_digits=12),
        ),
        migrations.RemoveConstraint(
            model_name="personalrecord", name="training_record_kind_valid"
        ),
        migrations.AlterField(
            model_name="personalrecord",
            name="kind",
            field=models.CharField(
                choices=[
                    ("weight", "Charge maximale"),
                    ("e1rm", "1RM estimé"),
                    ("volume", "Volume d'une série"),
                    ("reps", "Répétitions maximales"),
                    ("duration", "Durée la plus longue"),
                    ("distance", "Distance la plus longue"),
                ],
                max_length=8,
            ),
        ),
        migrations.AddConstraint(
            model_name="personalrecord",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    kind__in=["weight", "e1rm", "volume", "reps", "duration", "distance"]
                ),
                name="training_record_kind_valid",
            ),
        ),
    ]
