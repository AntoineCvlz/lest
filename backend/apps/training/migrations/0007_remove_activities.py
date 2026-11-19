"""Retrait de l'app `activities` (ADR 0017) : ses activités ont été recopiées en séances.

1. Garde-fou : chaque activité doit avoir sa séance recopiée (identifiant dérivé, comme le
   faisait `activities.services.copied_id`). Sinon la migration échoue sans rien supprimer :
   lancer `copy_activities` depuis la version précédente, puis migrer.
2. Table des activités supprimée (`IF EXISTS` : une base neuve ne l'a jamais eue), ainsi que
   ses lignes de `django_migrations` et ses types de contenu.

Irréversible : les activités ne reviennent pas (leurs séances restent).
"""

import hashlib
from uuid import UUID

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

ACTIVITY_TABLE = "activities_activity"


def copied_workout_id(activity_id: UUID) -> UUID:
    digest = hashlib.sha256(f"lest-activity/workout/{activity_id}".encode()).digest()
    return UUID(bytes=digest[:16], version=4)


def check_and_drop(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if ACTIVITY_TABLE not in connection.introspection.table_names(cursor):
            return
        cursor.execute(f"SELECT id FROM {ACTIVITY_TABLE}")  # noqa: S608  # nom constant
        activity_ids = [UUID(str(row[0])) for row in cursor.fetchall()]
    expected = {copied_workout_id(activity_id) for activity_id in activity_ids}
    workout_model = apps.get_model("training", "Workout")
    present = set(workout_model.objects.filter(pk__in=expected).values_list("pk", flat=True))
    missing = len(expected - present)
    if missing:
        raise RuntimeError(
            f"{missing} activités sans leur séance : lancer `copy_activities` avant de migrer."
        )
    schema_editor.execute(f"DROP TABLE {ACTIVITY_TABLE}")


def delete_content_types(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    apps.get_model("contenttypes", "ContentType").objects.filter(app_label="activities").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("training", "0006_lest_cardio_exercises"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(check_and_drop, migrations.RunPython.noop),
        migrations.RunSQL(
            "DELETE FROM django_migrations WHERE app = 'activities'", migrations.RunSQL.noop
        ),
        migrations.RunPython(delete_content_types, migrations.RunPython.noop),
    ]
