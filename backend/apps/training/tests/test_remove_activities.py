"""Migration `0007_remove_activities` (ADR 0017) : refuse tant qu'une activité n'a pas sa
séance recopiée, puis supprime la table."""

from datetime import UTC, datetime, timedelta
from importlib import import_module
from typing import Any
from uuid import uuid4

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = [("training", "0006_lest_cardio_exercises")]
AFTER = [("training", "0007_remove_activities")]
removal = import_module("apps.training.migrations.0007_remove_activities")
CREATE = "CREATE TABLE activities_activity (id uuid PRIMARY KEY)"


def migrate(targets: list[tuple[str, str]]) -> Any:
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


def tables() -> list[str]:
    with connection.cursor() as cursor:
        return connection.introspection.table_names(cursor)


@pytest.mark.django_db(transaction=True)
def test_the_table_goes_only_once_every_activity_has_its_workout() -> None:
    old = migrate(BEFORE)
    activity_id = uuid4()
    with connection.cursor() as cursor:
        cursor.execute(CREATE)
        cursor.execute("INSERT INTO activities_activity (id) VALUES (%s)", [activity_id])
    try:
        with pytest.raises(RuntimeError, match="copy_activities"):
            migrate(AFTER)
        assert "activities_activity" in tables()

        owner = old.get_model("accounts", "User").objects.create(email="cardio@example.com")
        started = datetime(2026, 11, 1, 12, tzinfo=UTC)
        old.get_model("training", "Workout").objects.create(
            id=removal.copied_workout_id(activity_id),
            owner=owner,
            started_at=started,
            ended_at=started + timedelta(minutes=30),
        )
        migrate(AFTER)

        assert "activities_activity" not in tables()
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE IF EXISTS activities_activity")
        migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())
