"""Migration de retrait de Basic-Fit (ADR 0016)."""

from datetime import date
from decimal import Decimal

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = [("body", "0004_bodyweight_source_and_more")]
AFTER = [("body", "0005_remove_basicfit")]


def migrate(targets: list[tuple[str, str]]) -> MigrationExecutor:
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(targets)
    return MigrationExecutor(connection)


@pytest.mark.django_db(transaction=True)
def test_scale_weights_are_deleted_and_manual_ones_kept() -> None:
    old = migrate(BEFORE).loader.project_state(BEFORE).apps
    owner = old.get_model("accounts", "User").objects.create(email="balance@example.com")
    weights = old.get_model("body", "BodyWeight").objects
    weights.create(owner=owner, date=date(2026, 11, 1), weight_kg=Decimal("80.10"), source="manual")
    weights.create(
        owner=owner, date=date(2026, 11, 2), weight_kg=Decimal("80.40"), source="basicfit"
    )

    new = migrate(AFTER).loader.project_state(AFTER).apps

    kept = new.get_model("body", "BodyWeight").objects.filter(owner_id=owner.pk)
    assert [row.date for row in kept] == [date(2026, 11, 1)]
    columns = {
        column.name
        for column in connection.introspection.get_table_description(
            connection.cursor(), "body_bodyweight"
        )
    }
    assert "source" not in columns
    assert not {"basicfit_connection", "basicfit_visit", "basicfit_pendinglogin"} & set(
        connection.introspection.table_names()
    )
