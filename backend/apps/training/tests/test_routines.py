"""Routines (ADR 0017) : séries prévues, raccourci « N x R », recopie au démarrage d'une
séance, « Mettre à jour la routine », plafonds, isolation et migration des cibles."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.training import services
from apps.training.models import Exercise, ExerciseKind, ProgramExercise, ProgramSet
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_programs import day, planned, program
from apps.training.tests.test_workouts_api import STARTED, Athlete, set_body

pytestmark = pytest.mark.django_db


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


@pytest.fixture
def bench() -> Exercise:
    return make_exercise()


def planned_set(athlete: Athlete, planned_id: UUID, position: int = 0, **values: Any) -> Any:
    body = {"program_exercise_id": str(planned_id), "position": position, **values}
    return athlete.put(f"/program-sets/{uuid4()}/", body)


def post(athlete: Athlete, path: str) -> Any:
    return athlete.client.post(f"/api/v1{path}", headers=athlete.headers)


def routine(athlete: Athlete, exercise: Exercise, **planned_fields: Any) -> tuple[UUID, UUID]:
    """Une séance type d'un exercice ; renvoie l'identifiant de la séance type et de l'exercice."""
    day_id = day(athlete, program(athlete))
    return day_id, planned(athlete, day_id, exercise, **planned_fields)


def sets_of(planned_id: UUID) -> list[tuple[str, float | None, int | None]]:
    rows = ProgramSet.objects.filter(program_exercise_id=planned_id).order_by("position")
    return [
        (row.set_type, None if row.weight_kg is None else float(row.weight_kg), row.reps)
        for row in rows
    ]


# --- Séries prévues -------------------------------------------------------------------------------


def test_planned_sets_are_written_one_by_one(alice: Athlete, bench: Exercise) -> None:
    _, planned_id = routine(alice, bench)

    warmup = planned_set(alice, planned_id, 3, set_type="warmup", weight_kg="40", reps=10)
    empty = planned_set(alice, planned_id, 4)  # charge et répétitions à trouver

    assert (warmup.status_code, empty.status_code) == (201, 201)
    assert sets_of(planned_id)[-2:] == [("warmup", 40.0, 10), ("normal", None, None)]


def test_a_planned_set_only_takes_the_columns_of_its_kind(alice: Athlete) -> None:
    _, planned_id = routine(alice, make_exercise(name="Gainage", kind=ExerciseKind.DURATION))

    refused = planned_set(alice, planned_id, weight_kg="10", duration_s=60)

    assert refused.status_code == 422
    assert refused.json()["errors"] == [{"loc": ["weight_kg"], "type": "not_allowed"}]
    assert planned_set(alice, planned_id, duration_s=60).status_code == 201


def test_an_exercise_holds_at_most_20_planned_sets(
    alice: Athlete, bench: Exercise, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(services, "MAX_PLANNED_SETS", 4)
    _, planned_id = routine(alice, bench, target_sets=4)

    refused = planned_set(alice, planned_id, 9)

    assert refused.status_code == 422
    assert refused.json()["errors"] == [{"loc": ["program_exercise_id"], "type": "too_many"}]


def test_another_account_cannot_touch_planned_sets(alice: Athlete, bench: Exercise) -> None:
    _, planned_id = routine(alice, bench)
    set_id = ProgramSet.objects.filter(program_exercise_id=planned_id).earliest("position").pk
    bob = Athlete()
    _, bob_planned = routine(bob, bench)

    body = {"program_exercise_id": str(bob_planned), "position": 0, "reps": 1}
    assert bob.put(f"/program-sets/{set_id}/", body).status_code == 404
    assert planned_set(bob, planned_id).status_code == 422  # parent d'un autre compte
    assert bob.delete(f"/program-sets/{set_id}/").status_code == 204  # sans effet
    assert ProgramSet.objects.filter(pk=set_id).exists()


def test_the_n_by_r_shortcut_rewrites_sets_and_keeps_loads(alice: Athlete, bench: Exercise) -> None:
    day_id, planned_id = routine(alice, bench, target_sets=3, target_reps=8)
    first = ProgramSet.objects.get(program_exercise_id=planned_id, position=0)
    alice.put(
        f"/program-sets/{first.pk}/",
        {"program_exercise_id": str(planned_id), "position": 0, "weight_kg": "80", "reps": 8},
    )

    body = {"day_id": str(day_id), "exercise_id": str(bench.pk), "position": 0}
    shown = alice.put(
        f"/program-exercises/{planned_id}/", body | {"target_sets": 2, "target_reps": 10}
    ).json()

    assert sets_of(planned_id) == [("normal", 80.0, 10), ("normal", None, 10)]
    assert (shown["target_sets"], shown["target_reps"]) == (2, 10)
    # Sans cible ni détail : les séries prévues restent.
    alice.put(f"/program-exercises/{planned_id}/", body | {"rest_seconds": 90})
    assert len(sets_of(planned_id)) == 2


def test_a_routine_holds_up_to_50_routines_per_folder(alice: Athlete) -> None:
    program_id = program(alice)
    for position in range(50):
        day(alice, program_id, name=f"Routine {position}", position=position)

    body = {"program_id": str(program_id), "name": "De trop", "position": 50}
    assert alice.put(f"/program-days/{uuid4()}/", body).status_code == 422


# --- Recopie et mise à jour -----------------------------------------------------------------------


def start_routine(athlete: Athlete, day_id: UUID) -> UUID:
    workout_id = uuid4()
    body = {"started_at": STARTED, "program_day_id": str(day_id)}
    assert athlete.put(f"/workouts/{workout_id}/", body).status_code == 201
    return workout_id


def test_starting_a_routine_copies_its_planned_sets_and_details(
    alice: Athlete, bench: Exercise
) -> None:
    day_id, planned_id = routine(alice, bench, target_sets=2, target_reps=8)
    body = {"day_id": str(day_id), "exercise_id": str(bench.pk), "position": 0}
    alice.put(f"/program-exercises/{planned_id}/", body | {"rest_seconds": 150, "note": "Lent"})
    planned_set(alice, planned_id, 5, set_type="warmup", weight_kg="40", reps=10)

    workout_id = start_routine(alice, day_id)
    [item] = alice.get(f"/workouts/{workout_id}/").json()["exercises"]

    assert [(row["set_type"], row["weight_kg"], row["reps"]) for row in item["planned_sets"]] == [
        ("normal", None, 8),
        ("normal", None, 8),
        ("warmup", 40.0, 10),
    ]
    assert (item["rest_seconds"], item["note"]) == (150, "Lent")
    assert (item["target_sets"], item["target_reps"]) == (2, 8)


def test_updating_the_routine_takes_the_sets_done_and_added_exercises(
    alice: Athlete, bench: Exercise
) -> None:
    day_id, planned_id = routine(alice, bench, target_sets=3, target_reps=8)
    workout_id = start_routine(alice, day_id)
    copied = services.copied_exercise_id(workout_id, planned_id)
    for position, (kg, reps) in enumerate((("80", 8), ("82.5", 6))):
        alice.put(f"/sets/{uuid4()}/", set_body(copied, position=position, weight_kg=kg, reps=reps))
    squat = make_exercise(name="Squat", category="legs")
    added = uuid4()
    alice.put(
        f"/workout-exercises/{added}/",
        {"workout_id": str(workout_id), "exercise_id": str(squat.pk), "position": 1},
    )
    alice.put(f"/sets/{uuid4()}/", set_body(added, weight_kg="100", reps=5))

    first = post(alice, f"/workouts/{workout_id}/update-routine/")
    again = post(alice, f"/workouts/{workout_id}/update-routine/")

    assert (first.status_code, again.status_code) == (200, 200)
    assert first.json() == again.json()
    assert sets_of(planned_id) == [("normal", 80.0, 8), ("normal", 82.5, 6)]
    squat_planned = ProgramExercise.objects.get(day_id=day_id, exercise=squat)
    assert sets_of(squat_planned.pk) == [("normal", 100.0, 5)]


def test_updating_needs_a_routine_and_the_owner(alice: Athlete, bench: Exercise) -> None:
    free_workout = uuid4()
    alice.put(f"/workouts/{free_workout}/", {"started_at": STARTED})
    day_id, _ = routine(alice, bench)
    workout_id = start_routine(alice, day_id)
    bob = Athlete()

    without = post(alice, f"/workouts/{free_workout}/update-routine/")

    assert without.status_code == 409
    assert without.json()["type"] == "urn:lest:problem:no-routine"
    assert post(bob, f"/workouts/{workout_id}/update-routine/").status_code == 404


# --- Migration des cibles -------------------------------------------------------------------------


BEFORE = [("training", "0004_workout_details")]
AFTER = [("training", "0005_routine_planned_sets")]


def migrate(targets: list[tuple[str, str]]) -> Any:
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


@pytest.mark.django_db(transaction=True)
def test_the_migration_turns_targets_into_planned_sets() -> None:
    old = migrate(BEFORE)
    owner = old.get_model("accounts", "User").objects.create(email="routine@example.com")
    exercise = old.get_model("training", "Exercise").objects.create(
        name="Squat", name_language="fr", category="legs", license="test"
    )
    program_row = old.get_model("training", "Program").objects.create(
        id=uuid4(), owner=owner, name="PPL", created_at=datetime(2026, 11, 1, tzinfo=UTC)
    )
    day_row = old.get_model("training", "ProgramDay").objects.create(
        id=uuid4(), program=program_row, name="Jambes", position=0
    )
    planned_row = old.get_model("training", "ProgramExercise").objects.create(
        id=uuid4(), day=day_row, exercise=exercise, position=0, target_sets=4, target_reps=6
    )

    new = migrate(AFTER)

    rows = new.get_model("training", "ProgramSet").objects.filter(
        program_exercise_id=planned_row.pk
    )
    assert [(row.position, row.set_type, row.reps) for row in rows.order_by("position")] == [
        (index, "normal", 6) for index in range(4)
    ]
    migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())
