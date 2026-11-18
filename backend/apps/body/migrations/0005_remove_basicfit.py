"""Retrait de Basic-Fit (ADR 0016, remplace l'ADR 0014).

1. Pesées importées des balances de club supprimées (choix produit), puis le champ `source`.
2. Tables de l'app `basicfit` supprimées : liaisons (jetons chiffrés compris), visites,
   connexions en cours. `IF EXISTS` : une base neuve ne les a jamais eues.
3. Types de contenu de l'app retirés (leurs permissions suivent).

Irréversible : les données supprimées ne reviennent pas.
"""

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

BASICFIT_TABLES = ("basicfit_visit", "basicfit_connection", "basicfit_pendinglogin")


def delete_scale_weights(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    apps.get_model("body", "BodyWeight").objects.filter(source="basicfit").delete()


def delete_content_types(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    apps.get_model("contenttypes", "ContentType").objects.filter(app_label="basicfit").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("body", "0004_bodyweight_source_and_more"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(delete_scale_weights, migrations.RunPython.noop),
        migrations.RemoveConstraint(model_name="bodyweight", name="body_weight_source_valid"),
        migrations.RemoveField(model_name="bodyweight", name="source"),
        migrations.RunSQL(
            [f"DROP TABLE IF EXISTS {table}" for table in BASICFIT_TABLES],
            migrations.RunSQL.noop,
        ),
        migrations.RunSQL(
            "DELETE FROM django_migrations WHERE app = 'basicfit'", migrations.RunSQL.noop
        ),
        migrations.RunPython(delete_content_types, migrations.RunPython.noop),
    ]
