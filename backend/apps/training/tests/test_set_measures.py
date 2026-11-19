"""Séries selon le type d'exercice (ADR 0017) : colonnes exigées, types de série, records,
volume, changement d'exercice, reconstruction des records et migration."""

from datetime import UTC, datetime
from decimal import Decimal
from io import StringIO
from typing import Any
from uuid import UUID, uuid4

import pytest
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.training import selectors
from apps.training.api.router import RecordKindName, SetTypeName
from apps.training.models import (
    Exercise,
    ExerciseKind,
    PersonalRecord,
    RecordKind,
    SetType,
    Workout,
)
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_workouts_api import Athlete, start

pytestmark = pytest.mark.django_db

AT = "2026-10-29T18:05:00+01:00"


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


def body(item_id: UUID, **measures: Any) -> dict[str, Any]:
    return {"workout_exercise_id": str(item_id), "position": 0, "performed_at": AT, **measures}


def put(athlete: Athlete, item_id: UUID, minute: int = 5, **measures: Any) -> Any:
    payload = body(item_id, **measures) | {"performed_at": f"2026-10-29T18:{minute:02d}:00+01:00"}
    return athlete.put(f"/sets/{uuid4()}/", payload)


def exercise_of(kind: ExerciseKind) -> Exercise:
    return make_exercise(name=f"Exercice {kind}", kind=kind)


VALID: dict[str, dict[str, Any]] = {
    ExerciseKind.WEIGHT_REPS: {"weight_kg": "80", "reps": 8},
    ExerciseKind.REPS: {"reps": 12},
    ExerciseKind.WEIGHTED_REPS: {"weight_kg": "10", "reps": 8},
    ExerciseKind.ASSISTED_REPS: {"weight_kg": "20", "reps": 8},
    ExerciseKind.DURATION: {"duration_s": 60},
    ExerciseKind.DISTANCE_DURATION: {"distance_m": "5000", "duration_s": 1500},
    ExerciseKind.WEIGHT_DISTANCE: {"weight_kg": "32", "distance_m": "40"},
}


# --- Colonnes exigées --------------------------------------------------------------------------


@pytest.mark.parametrize("kind", list(ExerciseKind))
def test_each_kind_takes_its_own_columns(alice: Athlete, kind: ExerciseKind) -> None:
    _, item_id = start(alice, exercise_of(kind))

    response = put(alice, item_id, **VALID[kind])

    assert response.status_code == 201, response.content
    saved = response.json()
    filled = {key for key in ("weight_kg", "reps", "duration_s", "distance_m") if saved[key]}
    assert filled == set(VALID[kind])


def test_a_missing_or_extra_column_is_refused_without_its_value(alice: Athlete) -> None:
    _, item_id = start(alice, exercise_of(ExerciseKind.DISTANCE_DURATION))

    response = put(alice, item_id, distance_m="5000", reps=10)

    assert response.status_code == 422
    assert sorted(response.json()["errors"], key=lambda error: error["loc"]) == [
        {"loc": ["duration_s"], "type": "required"},
        {"loc": ["reps"], "type": "not_allowed"},
    ]


@pytest.mark.parametrize(
    "measures",
    [{"duration_s": 86_401}, {"duration_s": -1}, {"distance_m": "1000000.1"}, {"duration_s": "60"}],
)
def test_out_of_range_measures_are_refused(alice: Athlete, measures: dict[str, Any]) -> None:
    _, item_id = start(alice, exercise_of(ExerciseKind.DURATION))

    assert put(alice, item_id, **measures).status_code == 422


# --- Types de série ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({}, "normal"),
        ({"set_type": "drop"}, "drop"),
        ({"set_type": "failure"}, "failure"),
        ({"set_type": "warmup"}, "warmup"),
    ],
)
def test_the_set_type_is_saved(alice: Athlete, payload: dict[str, Any], expected: str) -> None:
    _, item_id = start(alice, make_exercise())

    saved = put(alice, item_id, weight_kg="80", reps=8, **payload).json()

    assert saved["set_type"] == expected


def test_drop_and_failure_sets_count_as_working_sets(alice: Athlete) -> None:
    _, item_id = start(alice, make_exercise())
    put(alice, item_id, 1, weight_kg="100", reps=5, set_type="warmup")
    put(alice, item_id, 2, weight_kg="80", reps=8, set_type="drop")
    put(alice, item_id, 3, weight_kg="60", reps=10, set_type="failure")

    [summary] = alice.get("/workouts/").json()["items"]

    assert summary["working_set_count"] == 2
    assert summary["volume_kg"] == 1240.0  # 80 fois 8, plus 60 fois 10 ; échauffement exclu


# --- Records selon le type -----------------------------------------------------------------------


def records_of(exercise: Exercise) -> list[tuple[str, float]]:
    rows = PersonalRecord.objects.filter(exercise=exercise).order_by("kind")
    return [(row.kind, float(row.value)) for row in rows]


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        (ExerciseKind.REPS, [("reps", 12.0)]),
        (ExerciseKind.WEIGHTED_REPS, [("volume", 80.0), ("weight", 10.0)]),
        (ExerciseKind.ASSISTED_REPS, [("reps", 8.0)]),  # l'assistance n'est pas un record
        (ExerciseKind.DURATION, [("duration", 60.0)]),
        (ExerciseKind.DISTANCE_DURATION, [("distance", 5000.0), ("duration", 1500.0)]),
        (ExerciseKind.WEIGHT_DISTANCE, [("distance", 40.0), ("weight", 32.0)]),
    ],
)
def test_records_follow_the_kind(
    alice: Athlete, kind: ExerciseKind, expected: list[tuple[str, float]]
) -> None:
    exercise = exercise_of(kind)
    _, item_id = start(alice, exercise)

    put(alice, item_id, **VALID[kind])

    assert records_of(exercise) == expected


def test_record_values_are_exposed_in_their_unit(alice: Athlete) -> None:
    run = exercise_of(ExerciseKind.DISTANCE_DURATION)
    _, item_id = start(alice, run)

    saved = put(alice, item_id, distance_m="5000", duration_s=1500).json()

    assert sorted((r["kind"], r["value"]) for r in saved["records"]) == [
        ("distance", 5000.0),
        ("duration", 1500.0),
    ]


# --- Volume ---------------------------------------------------------------------------------------


def test_volume_counts_loaded_kinds_only(alice: Athlete) -> None:
    workout_id, bench_item = start(alice, make_exercise())
    put(alice, bench_item, 1, weight_kg="80", reps=10)
    for kind, minute in ((ExerciseKind.WEIGHTED_REPS, 2), (ExerciseKind.ASSISTED_REPS, 3)):
        item_id = uuid4()
        alice.put(
            f"/workout-exercises/{item_id}/",
            {
                "workout_id": str(workout_id),
                "exercise_id": str(exercise_of(kind).pk),
                "position": 1,
            },
        )
        put(alice, item_id, minute, **VALID[kind])

    workout = selectors.get_workout(owner=alice.user, workout_id=workout_id)
    [summary] = alice.get("/workouts/").json()["items"]

    # 80 fois 10, plus le lest de 10 fois 8 ; l'assistance de 20 kg ne compte pas.
    assert workout is not None
    assert selectors.workout_volume_kg(workout) == Decimal(880)
    assert summary["volume_kg"] == 880.0


# --- Changement d'exercice ---------------------------------------------------------------------


def test_an_exercise_with_sets_is_only_swapped_for_one_of_the_same_kind(alice: Athlete) -> None:
    workout_id, item_id = start(alice, make_exercise())
    put(alice, item_id, weight_kg="80", reps=8)

    def swap(exercise: Exercise) -> Any:
        return alice.put(
            f"/workout-exercises/{item_id}/",
            {"workout_id": str(workout_id), "exercise_id": str(exercise.pk), "position": 0},
        )

    refused = swap(exercise_of(ExerciseKind.DURATION))
    assert refused.status_code == 422
    assert refused.json()["errors"] == [{"loc": ["exercise_id"], "type": "kind_mismatch"}]
    assert swap(make_exercise(name="Squat")).status_code == 200


def test_another_account_cannot_probe_a_workout_exercise_through_its_kind(
    alice: Athlete,
) -> None:
    _, alice_item = start(alice, make_exercise())
    put(alice, alice_item, weight_kg="80", reps=8)
    bob = Athlete()
    bob_workout, _ = start(bob, make_exercise(name="Squat"))

    probe = bob.put(
        f"/workout-exercises/{alice_item}/",
        {
            "workout_id": str(bob_workout),
            "exercise_id": str(exercise_of(ExerciseKind.DURATION).pk),
            "position": 0,
        },
    )

    assert probe.status_code == 404  # comme un identifiant inconnu, sans révéler le type


# --- Reconstruction, énumérations, migration -----------------------------------------------------


def test_rebuilding_the_records_restores_every_kind(alice: Athlete) -> None:
    bench = make_exercise()
    _, item_id = start(alice, bench)
    put(alice, item_id, weight_kg="80", reps=5)
    PersonalRecord.objects.filter(kind=RecordKind.SET_VOLUME).delete()
    output = StringIO()

    call_command("rebuild_records", stdout=output)

    assert records_of(bench) == [("e1rm", 93.33), ("volume", 400.0), ("weight", 80.0)]
    assert "1 comptes, 3 records" in output.getvalue()


def test_the_openapi_enums_match_the_models() -> None:
    from typing import get_args

    assert list(get_args(SetTypeName)) == list(SetType.values)
    assert list(get_args(RecordKindName)) == list(RecordKind.values)


BEFORE = [("training", "0002_exercise_kind_and_owner")]
AFTER = [("training", "0003_set_types_and_measures")]


def migrate(targets: list[tuple[str, str]]) -> Any:
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


@pytest.mark.django_db(transaction=True)
def test_the_migration_keeps_warm_ups_and_record_values() -> None:
    old = migrate(BEFORE)
    owner = old.get_model("accounts", "User").objects.create(email="migration@example.com")
    exercise = old.get_model("training", "Exercise").objects.create(
        name="Squat", name_language="fr", category="legs", license="test"
    )
    workout = old.get_model("training", "Workout").objects.create(
        id=uuid4(), owner=owner, started_at=datetime(2026, 11, 1, tzinfo=UTC)
    )
    item = old.get_model("training", "WorkoutExercise").objects.create(
        id=uuid4(), workout=workout, exercise=exercise, position=0
    )
    sets = old.get_model("training", "Set").objects
    moment = datetime(2026, 11, 1, 10, tzinfo=UTC)
    warmup = sets.create(
        id=uuid4(),
        workout_exercise=item,
        position=0,
        weight_kg=40,
        reps=10,
        is_warmup=True,
        performed_at=moment,
    )
    working = sets.create(
        id=uuid4(),
        workout_exercise=item,
        position=1,
        weight_kg=100,
        reps=5,
        is_warmup=False,
        performed_at=moment,
    )
    old.get_model("training", "PersonalRecord").objects.create(
        owner=owner,
        exercise=exercise,
        kind="weight",
        value_kg=100,
        set=working,
        achieved_at=moment,
    )

    new = migrate(AFTER)

    migrated = new.get_model("training", "Set").objects
    assert migrated.get(pk=warmup.pk).set_type == "warmup"
    assert migrated.get(pk=working.pk).set_type == "normal"
    assert new.get_model("training", "PersonalRecord").objects.get().value == Decimal(100)
    Workout.objects.filter(pk=workout.pk).delete()
