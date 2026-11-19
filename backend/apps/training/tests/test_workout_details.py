"""Détails d'une séance et de ses exercices (ADR 0017) : nom, notes chiffrées, fréquence
cardiaque, ressenti, repos, superset ; repos par défaut du profil."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from django.db import connection

from apps.accounts.selectors import export_account
from apps.training.models import Exercise, Workout, WorkoutExercise
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_programs import day, planned, program
from apps.training.tests.test_workouts_api import STARTED, Athlete, start

pytestmark = pytest.mark.django_db

NOTE = "Épaule gauche sensible.\nPrise serrée."


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


@pytest.fixture
def bench() -> Exercise:
    return make_exercise()


def put_workout(athlete: Athlete, workout_id: UUID, **fields: Any) -> Any:
    return athlete.put(f"/workouts/{workout_id}/", {"started_at": STARTED, **fields})


def put_item(
    athlete: Athlete, workout_id: UUID, item_id: UUID, bench: Exercise, **fields: Any
) -> Any:
    body = {"workout_id": str(workout_id), "exercise_id": str(bench.pk), "position": 0}
    return athlete.put(f"/workout-exercises/{item_id}/", body | fields)


# --- Séance ---------------------------------------------------------------------------------------


def test_workout_details_are_saved_and_kept_when_absent(alice: Athlete) -> None:
    workout_id = uuid4()
    created = put_workout(
        alice, workout_id, name="  Poussée  ", note=NOTE, avg_heart_rate=128, feeling=4
    )

    # Fin de séance envoyée par la file hors ligne : dates seulement.
    finished = put_workout(alice, workout_id, ended_at="2026-10-29T19:30:00+01:00")

    assert created.status_code == 201
    assert {key: finished.json()[key] for key in ("name", "note", "avg_heart_rate", "feeling")} == {
        "name": "Poussée",
        "note": NOTE,
        "avg_heart_rate": 128,
        "feeling": 4,
    }


def test_null_or_empty_clears_a_detail(alice: Athlete) -> None:
    workout_id = uuid4()
    put_workout(alice, workout_id, note=NOTE, avg_heart_rate=128, feeling=4)

    cleared = put_workout(alice, workout_id, note="", avg_heart_rate=None, feeling=None).json()

    assert (cleared["note"], cleared["avg_heart_rate"], cleared["feeling"]) == (None, None, None)


def test_notes_and_feelings_are_encrypted_at_rest(alice: Athlete, bench: Exercise) -> None:
    workout_id, item_id = uuid4(), uuid4()
    put_workout(alice, workout_id, note=NOTE, avg_heart_rate=128, feeling=4)
    put_item(alice, workout_id, item_id, bench, note="Douleur au coude")

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT note, avg_heart_rate, feeling FROM training_workout WHERE id = %s",
            [workout_id],
        )
        stored = cursor.fetchone()
        cursor.execute("SELECT note FROM training_workoutexercise WHERE id = %s", [item_id])
        stored_item = cursor.fetchone()

    note, heart_rate, feeling = stored
    assert "Épaule" not in note
    assert heart_rate != "128"
    assert feeling != "4"
    assert "coude" not in stored_item[0]
    assert Workout.objects.get(pk=workout_id).note == NOTE


@pytest.mark.parametrize(
    "fields",
    [
        {"note": "x" * 1001},
        {"note": "nul\x00"},
        {"name": "x" * 81},
        {"name": "ligne\nnouvelle"},
        {"avg_heart_rate": 29},
        {"avg_heart_rate": 231},
        {"avg_heart_rate": "128"},
        {"feeling": 0},
        {"feeling": 6},
    ],
)
def test_invalid_workout_details_are_refused(alice: Athlete, fields: dict[str, Any]) -> None:
    assert put_workout(alice, uuid4(), **fields).status_code == 422


def test_a_workout_started_from_a_program_takes_its_name(alice: Athlete, bench: Exercise) -> None:
    program_day = day(alice, program(alice), name="Tirage")
    planned(alice, program_day, bench)

    started = put_workout(alice, uuid4(), program_day_id=str(program_day)).json()
    named = put_workout(alice, uuid4(), program_day_id=str(program_day), name="Dos lourd").json()

    assert (started["name"], named["name"]) == ("Tirage", "Dos lourd")


def test_another_account_cannot_annotate_a_workout(alice: Athlete) -> None:
    workout_id = uuid4()
    put_workout(alice, workout_id, note=NOTE)
    bob = Athlete()

    assert put_workout(bob, workout_id, note="Lu ?").status_code == 404
    assert Workout.objects.get(pk=workout_id).note == NOTE


# --- Exercices de séance -------------------------------------------------------------------------


def test_exercise_details_are_saved_kept_and_shown_with_the_kind(
    alice: Athlete, bench: Exercise
) -> None:
    workout_id, item_id = start(alice, bench)
    saved = put_item(alice, workout_id, item_id, bench, rest_seconds=90, superset=1, note="Lent")

    moved = put_item(alice, workout_id, item_id, bench, position=2)  # sans détails : gardés
    [shown] = alice.get(f"/workouts/{workout_id}/").json()["exercises"]

    assert saved.status_code == 200
    assert {key: moved.json()[key] for key in ("rest_seconds", "superset", "note")} == {
        "rest_seconds": 90,
        "superset": 1,
        "note": "Lent",
    }
    assert (shown["rest_seconds"], shown["exercise_kind"]) == (90, "weight_reps")


@pytest.mark.parametrize(
    "fields",
    [
        {"rest_seconds": 14},
        {"rest_seconds": 601},
        {"superset": 0},
        {"superset": 51},
        {"note": "x" * 1001},
    ],
)
def test_invalid_exercise_details_are_refused(
    alice: Athlete, bench: Exercise, fields: dict[str, Any]
) -> None:
    workout_id, item_id = start(alice, bench)

    assert put_item(alice, workout_id, item_id, bench, **fields).status_code == 422
    assert WorkoutExercise.objects.get(pk=item_id).rest_seconds is None


# --- Profil et export ----------------------------------------------------------------------------


def profile(athlete: Athlete, **fields: Any) -> Any:
    body = {"height_m": 1.8, "goal": "gain", "unit_system": "metric"}
    return athlete.put("/me/profile/", body | fields)


def test_the_profile_rest_defaults_to_two_minutes_and_is_kept_when_absent(alice: Athlete) -> None:
    assert profile(alice).json()["default_rest_seconds"] == 120
    assert profile(alice, default_rest_seconds=90).json()["default_rest_seconds"] == 90
    assert profile(alice, goal="cut").json()["default_rest_seconds"] == 90
    assert profile(alice, default_rest_seconds=10).status_code == 422


def test_workout_details_join_the_export(alice: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    put_workout(alice, workout_id, name="Poussée", note=NOTE, avg_heart_rate=128, feeling=4)
    put_item(alice, workout_id, item_id, bench, rest_seconds=90, superset=1, note="Lent")

    [workout] = export_account(alice.user)["workouts"]

    assert (workout["name"], workout["note"], workout["avg_heart_rate"], workout["feeling"]) == (
        "Poussée",
        NOTE,
        128,
        4,
    )
    item = workout["exercises"][0]
    assert (item["rest_seconds"], item["superset"], item["note"]) == (90, 1, "Lent")
