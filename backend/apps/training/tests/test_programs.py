"""Programmes : séances types et cibles, démarrage d'une séance depuis un programme, isolation."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.accounts.selectors import export_account
from apps.training import services
from apps.training.models import (
    Exercise,
    Program,
    ProgramDay,
    ProgramExercise,
    Workout,
    WorkoutExercise,
)
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_workouts_api import STARTED, Athlete, set_body

pytestmark = pytest.mark.django_db


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


@pytest.fixture
def bench() -> Exercise:
    return make_exercise()


def program(athlete: Athlete, name: str = "PPL") -> UUID:
    program_id = uuid4()
    assert athlete.put(f"/programs/{program_id}/", {"name": name}).status_code == 201
    return program_id


def day(athlete: Athlete, program_id: UUID, name: str = "Poussée", position: int = 0) -> UUID:
    day_id = uuid4()
    body = {"program_id": str(program_id), "name": name, "position": position}
    assert athlete.put(f"/program-days/{day_id}/", body).status_code == 201
    return day_id


def planned_body(day_id: UUID, exercise: Exercise, **overrides: Any) -> dict[str, Any]:
    return {
        "day_id": str(day_id),
        "exercise_id": str(exercise.pk),
        "position": 0,
        "target_sets": 4,
        "target_reps": 8,
        **overrides,
    }


def planned(athlete: Athlete, day_id: UUID, exercise: Exercise, **overrides: Any) -> UUID:
    planned_id = uuid4()
    response = athlete.put(
        f"/program-exercises/{planned_id}/", planned_body(day_id, exercise, **overrides)
    )
    assert response.status_code == 201
    return planned_id


# --- Écritures --------------------------------------------------------------------------------


def test_a_program_is_built_and_read_back_with_its_days_and_targets(
    alice: Athlete, bench: Exercise
) -> None:
    program_id = program(alice)
    legs = day(alice, program_id, "Jambes", position=1)
    push = day(alice, program_id, "Poussée", position=0)
    planned(alice, push, bench, target_sets=5, target_reps=5)

    [read] = alice.get("/programs/").json()

    assert read["name"] == "PPL"
    assert [one["id"] for one in read["days"]] == [str(push), str(legs)]
    [line] = read["days"][0]["exercises"]
    assert (line["exercise_name"], line["target_sets"], line["target_reps"]) == (
        "Développé couché",
        5,
        5,
    )
    assert line["exercise_image"] is None
    assert alice.get(f"/programs/{program_id}/").json() == read


def test_writes_are_idempotent(alice: Athlete, bench: Exercise) -> None:
    program_id = program(alice)
    day_id = day(alice, program_id)
    planned_id = planned(alice, day_id, bench)

    assert alice.put(f"/programs/{program_id}/", {"name": "Renommé"}).status_code == 200
    replay = alice.put(
        f"/program-exercises/{planned_id}/", planned_body(day_id, bench, target_reps=10)
    )
    assert replay.status_code == 200
    assert replay.json()["target_reps"] == 10
    assert Program.objects.get().name == "Renommé"


@pytest.mark.parametrize(
    ("field", "value"),
    [("target_sets", 0), ("target_sets", 21), ("target_reps", 0), ("target_reps", 101)],
)
def test_targets_are_bounded(alice: Athlete, bench: Exercise, field: str, value: int) -> None:
    day_id = day(alice, program(alice))

    body = planned_body(day_id, bench, **{field: value})

    assert alice.put(f"/program-exercises/{uuid4()}/", body).status_code == 422


@pytest.mark.parametrize("name", ["", "   ", "\x00", "a\x00b", "tab\there", "x" * 81])
def test_unusable_names_are_refused(alice: Athlete, name: str) -> None:
    response = alice.put(f"/programs/{uuid4()}/", {"name": name})

    assert response.status_code == 422
    assert [error["loc"] for error in response.json()["errors"]] == [["body", "payload", "name"]]


def test_names_are_trimmed(alice: Athlete) -> None:
    program_id = uuid4()
    alice.put(f"/programs/{program_id}/", {"name": "  Haut / bas  "})

    assert Program.objects.get(pk=program_id).name == "Haut / bas"


def test_an_unknown_parent_is_refused(alice: Athlete, bench: Exercise) -> None:
    missing_program = {"program_id": str(uuid4()), "name": "Poussée", "position": 0}
    response = alice.put(f"/program-days/{uuid4()}/", missing_program)
    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["program_id"], "type": "unknown"}]

    day_id = day(alice, program(alice))
    response = alice.put(
        f"/program-exercises/{uuid4()}/",
        {**planned_body(day_id, bench), "exercise_id": str(uuid4())},
    )
    assert response.status_code == 422


def test_programs_days_and_exercises_are_capped(
    alice: Athlete, bench: Exercise, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(services, "MAX_PROGRAMS", 1)
    monkeypatch.setattr(services, "MAX_DAYS_PER_PROGRAM", 1)
    monkeypatch.setattr(services, "MAX_EXERCISES_PER_DAY", 1)
    program_id = program(alice)
    day_id = day(alice, program_id)
    planned(alice, day_id, bench)

    assert alice.put(f"/programs/{uuid4()}/", {"name": "Deux"}).status_code == 422
    second_day = {"program_id": str(program_id), "name": "Tirage", "position": 1}
    assert alice.put(f"/program-days/{uuid4()}/", second_day).status_code == 422
    assert (
        alice.put(f"/program-exercises/{uuid4()}/", planned_body(day_id, bench)).status_code == 422
    )


def test_deletes_are_idempotent_and_cascade(alice: Athlete, bench: Exercise) -> None:
    program_id = program(alice)
    day_id = day(alice, program_id)
    planned_id = planned(alice, day_id, bench)

    assert alice.delete(f"/program-exercises/{planned_id}/").status_code == 204
    assert alice.delete(f"/program-exercises/{planned_id}/").status_code == 204
    assert alice.delete(f"/program-days/{day_id}/").status_code == 204
    assert alice.delete(f"/programs/{program_id}/").status_code == 204
    assert alice.delete(f"/programs/{program_id}/").status_code == 204
    assert alice.get("/programs/").json() == []


# --- Isolation --------------------------------------------------------------------------------


def test_nobody_reads_or_writes_another_account_program(alice: Athlete, bench: Exercise) -> None:
    program_id = program(alice)
    day_id = day(alice, program_id)
    planned_id = planned(alice, day_id, bench)
    bob = Athlete()

    assert bob.get("/programs/").json() == []
    assert bob.get(f"/programs/{program_id}/").status_code == 404
    assert bob.put(f"/programs/{program_id}/", {"name": "Volé"}).status_code == 404
    day_body = {"program_id": str(program_id), "name": "Ajout", "position": 1}
    assert bob.put(f"/program-days/{uuid4()}/", day_body).status_code == 422
    assert (
        bob.put(f"/program-exercises/{planned_id}/", planned_body(day_id, bench)).status_code == 422
    )
    # Parent d'un autre compte : inconnu (422) avant même l'identifiant visé (ADR 0003).
    # Déplacer une ligne d'Alice sous un parent de Bob : 404, rien n'est écrit.
    bob_program = program(bob, "À moi")
    bob_day = day(bob, bob_program)
    moved_day = {"program_id": str(bob_program), "name": "Volée", "position": 0}
    assert bob.put(f"/program-days/{day_id}/", moved_day).status_code == 404
    assert (
        bob.put(f"/program-exercises/{planned_id}/", planned_body(bob_day, bench)).status_code
        == 404
    )
    for path in (
        f"/programs/{program_id}/",
        f"/program-days/{day_id}/",
        f"/program-exercises/{planned_id}/",
    ):
        assert bob.delete(path).status_code == 204  # sans effet, et sans le dire

    assert ProgramDay.objects.get(pk=day_id).program_id == program_id
    assert ProgramExercise.objects.get(pk=planned_id).day_id == day_id

    [read] = alice.get("/programs/").json()
    assert read["name"] == "PPL"
    assert len(read["days"][0]["exercises"]) == 1


# --- Séance depuis un programme -------------------------------------------------------------


def start_from(athlete: Athlete, day_id: UUID, workout_id: UUID | None = None) -> Any:
    workout_id = workout_id or uuid4()
    body = {"started_at": STARTED, "program_day_id": str(day_id)}
    return athlete.put(f"/workouts/{workout_id}/", body)


def test_a_workout_started_from_a_day_gets_its_exercises_and_targets(
    alice: Athlete, bench: Exercise
) -> None:
    squat = make_exercise(name="Squat")
    day_id = day(alice, program(alice))
    planned(alice, day_id, bench, position=0, target_sets=4, target_reps=8)
    planned(alice, day_id, squat, position=1, target_sets=5, target_reps=5)
    workout_id = uuid4()

    started = start_from(alice, day_id, workout_id)

    assert started.status_code == 201
    assert started.json()["program_day_id"] == str(day_id)
    lines = alice.get(f"/workouts/{workout_id}/").json()["exercises"]
    assert [(one["exercise_name"], one["target_sets"], one["target_reps"]) for one in lines] == [
        ("Développé couché", 4, 8),
        ("Squat", 5, 5),
    ]


def test_replaying_the_start_copies_nothing_twice(alice: Athlete, bench: Exercise) -> None:
    day_id = day(alice, program(alice))
    planned(alice, day_id, bench)
    workout_id = uuid4()

    start_from(alice, day_id, workout_id)
    assert start_from(alice, day_id, workout_id).status_code == 200

    assert WorkoutExercise.objects.filter(workout_id=workout_id).count() == 1


def test_editing_the_program_later_does_not_rewrite_the_workout(
    alice: Athlete, bench: Exercise
) -> None:
    day_id = day(alice, program(alice))
    planned_id = planned(alice, day_id, bench, target_reps=8)
    workout_id = uuid4()
    start_from(alice, day_id, workout_id)

    alice.put(f"/program-exercises/{planned_id}/", planned_body(day_id, bench, target_reps=12))
    alice.delete(f"/program-days/{day_id}/")

    [line] = alice.get(f"/workouts/{workout_id}/").json()["exercises"]
    assert line["target_reps"] == 8
    assert Workout.objects.get(pk=workout_id).program_day_id is None


def test_another_account_day_cannot_seed_a_workout(alice: Athlete, bench: Exercise) -> None:
    day_id = day(alice, program(alice))
    planned(alice, day_id, bench)
    bob = Athlete()

    response = start_from(bob, day_id)

    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["program_day_id"], "type": "unknown"}]
    assert not Workout.objects.filter(owner=bob.user).exists()


def test_a_free_workout_has_no_targets(alice: Athlete, bench: Exercise) -> None:
    workout_id, line_id = uuid4(), uuid4()
    alice.put(f"/workouts/{workout_id}/", {"started_at": STARTED})
    alice.put(
        f"/workout-exercises/{line_id}/",
        {"workout_id": str(workout_id), "exercise_id": str(bench.pk), "position": 0},
    )

    detail = alice.get(f"/workouts/{workout_id}/").json()

    assert detail["program_day_id"] is None
    assert (detail["exercises"][0]["target_sets"], detail["exercises"][0]["target_reps"]) == (
        None,
        None,
    )


def test_programs_are_in_the_data_export(alice: Athlete, bench: Exercise) -> None:
    day_id = day(alice, program(alice))
    planned(alice, day_id, bench, target_sets=3, target_reps=10)

    exported = export_account(alice.user)["programs"]

    assert exported == [
        {
            "name": "PPL",
            "days": [
                {
                    "name": "Poussée",
                    "exercises": [
                        {"exercise": "Développé couché", "target_sets": 3, "target_reps": 10}
                    ],
                }
            ],
        }
    ]


def test_copied_lines_accept_sets_and_can_be_removed(alice: Athlete, bench: Exercise) -> None:
    day_id = day(alice, program(alice))
    planned(alice, day_id, bench)
    workout_id = uuid4()
    start_from(alice, day_id, workout_id)
    [line] = alice.get(f"/workouts/{workout_id}/").json()["exercises"]

    logged = alice.put(f"/sets/{uuid4()}/", set_body(UUID(line["id"])))

    assert logged.status_code == 201
    assert alice.delete(f"/workout-exercises/{line['id']}/").status_code == 204
    assert not WorkoutExercise.objects.filter(workout_id=workout_id).exists()


def test_a_workout_can_be_finished_after_its_program_is_gone(
    alice: Athlete, bench: Exercise
) -> None:
    program_id = program(alice)
    day_id = day(alice, program_id)
    planned(alice, day_id, bench)
    workout_id = uuid4()
    start_from(alice, day_id, workout_id)
    alice.delete(f"/programs/{program_id}/")

    finished = alice.put(
        f"/workouts/{workout_id}/",
        {"started_at": STARTED, "ended_at": STARTED, "program_day_id": str(day_id)},
    )

    assert finished.status_code == 200
    assert finished.json()["program_day_id"] is None
    assert WorkoutExercise.objects.filter(workout_id=workout_id).count() == 1


def test_the_program_day_is_only_read_when_the_workout_is_created(
    alice: Athlete, bench: Exercise
) -> None:
    program_id = program(alice)
    first, other = day(alice, program_id), day(alice, program_id, "Tirage", position=1)
    planned(alice, other, bench)
    workout_id = uuid4()
    start_from(alice, first, workout_id)

    start_from(alice, other, workout_id)

    assert Workout.objects.get(pk=workout_id).program_day_id == first
    assert not WorkoutExercise.objects.filter(workout_id=workout_id).exists()


def test_copied_targets_stay_in_the_export_once_the_program_is_gone(
    alice: Athlete, bench: Exercise
) -> None:
    program_id = program(alice)
    day_id = day(alice, program_id)
    planned(alice, day_id, bench, target_sets=3, target_reps=8)
    start_from(alice, day_id)
    alice.delete(f"/programs/{program_id}/")

    [workout] = export_account(alice.user)["workouts"]

    assert (workout["exercises"][0]["target_sets"], workout["exercises"][0]["target_reps"]) == (
        3,
        8,
    )


def test_starting_from_a_day_locks_it() -> None:
    # Une suppression concurrente de la séance type attend la fin du démarrage (sinon 500).
    alice = Athlete()
    day_id = day(alice, program(alice))

    with CaptureQueriesContext(connection) as queries:
        start_from(alice, day_id)

    assert any(
        'FROM "training_programday"' in query["sql"] and "FOR UPDATE" in query["sql"]
        for query in queries.captured_queries
    )
