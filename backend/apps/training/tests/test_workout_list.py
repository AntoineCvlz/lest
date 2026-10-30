"""Lectures de l'écran de séance : liste des séances (en cours d'abord à retrouver) et
séries de la dernière fois pour un exercice ; isolation entre comptes."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest

from apps.training.tests.factories import make_exercise
from apps.training.tests.test_workouts_api import Athlete, set_body

pytestmark = pytest.mark.django_db

START = datetime(2026, 10, 1, 18, tzinfo=UTC)


def put_workout(athlete: Athlete, days: int, *, ended: bool = True) -> str:
    workout_id = str(uuid4())
    started = START + timedelta(days=days)
    body = {"started_at": started.isoformat()}
    if ended:
        body["ended_at"] = (started + timedelta(hours=1)).isoformat()
    assert athlete.put(f"/workouts/{workout_id}/", body).status_code == 201
    return workout_id


def ids(response: Any) -> list[str]:
    assert response.status_code == 200
    return [item["id"] for item in response.json()["items"]]


def test_workouts_are_listed_newest_first_and_ongoing_ones_can_be_found() -> None:
    alice = Athlete()
    old = put_workout(alice, 0)
    recent = put_workout(alice, 5)
    ongoing = put_workout(alice, 10, ended=False)

    assert ids(alice.get("/workouts/")) == [ongoing, recent, old]
    assert ids(alice.get("/workouts/?ongoing=true")) == [ongoing]
    assert ids(alice.get("/workouts/?ongoing=false")) == [recent, old]


def test_the_cursor_walks_every_workout_once_even_with_equal_start_times() -> None:
    alice = Athlete()
    created = {put_workout(alice, day) for day in (0, 1, 1, 1, 2)}
    seen: list[str] = []
    path = "/workouts/?limit=2"
    while True:
        body = alice.get(path).json()
        seen += [item["id"] for item in body["items"]]
        if body["next_cursor"] is None:
            break
        path = f"/workouts/?limit=2&cursor={body['next_cursor']}"

    assert len(seen) == len(set(seen)) == 5
    assert set(seen) == created


def test_a_tampered_cursor_is_refused() -> None:
    # Curseur bien formé mais date illisible : ["x","y"].
    response = Athlete().get("/workouts/?cursor=WyJ4IiwieSJd")

    assert response.status_code == 422
    assert response.json()["type"] == "urn:lest:problem:invalid-cursor"


def test_nobody_lists_another_account_workouts() -> None:
    alice, bob = Athlete(), Athlete()
    put_workout(alice, 0, ended=False)

    assert ids(bob.get("/workouts/")) == []
    assert ids(bob.get("/workouts/?ongoing=true")) == []


# --- Dernière séance d'un exercice (pré-remplissage) ----------------------------------------


def put_sets(athlete: Athlete, workout_id: str, exercise_id: str, weights: list[str]) -> None:
    item_id = str(uuid4())
    body = {"workout_id": workout_id, "exercise_id": exercise_id, "position": 0}
    assert athlete.put(f"/workout-exercises/{item_id}/", body).status_code == 201
    for position, weight in enumerate(weights):
        assert (
            athlete.put(
                f"/sets/{uuid4()}/",
                set_body(UUID(item_id), position=position, weight_kg=weight),
            ).status_code
            == 201
        )


def weights(response: Any) -> list[float]:
    assert response.status_code == 200
    return [one["weight_kg"] for one in response.json()["sets"]]


def test_last_sets_come_from_the_latest_workout_with_this_exercise() -> None:
    alice = Athlete()
    bench, squat = make_exercise(), make_exercise(name="Squat")
    older, newer, today = put_workout(alice, 0), put_workout(alice, 3), put_workout(alice, 6)
    put_sets(alice, older, str(bench.pk), ["60"])
    put_sets(alice, newer, str(bench.pk), ["70", "72.5"])
    put_sets(alice, today, str(squat.pk), ["100"])  # autre exercice : ignoré

    assert weights(alice.get(f"/exercises/{bench.pk}/last-sets/")) == [70.0, 72.5]


def test_the_ongoing_workout_can_be_left_out() -> None:
    alice = Athlete()
    bench = make_exercise()
    last_week, ongoing = put_workout(alice, 0), put_workout(alice, 7, ended=False)
    put_sets(alice, last_week, str(bench.pk), ["80"])
    put_sets(alice, ongoing, str(bench.pk), ["82.5"])

    path = f"/exercises/{bench.pk}/last-sets/"
    assert weights(alice.get(path)) == [82.5]
    assert weights(alice.get(f"{path}?exclude_workout={ongoing}")) == [80.0]


def test_last_sets_are_empty_for_a_new_exercise_or_another_account() -> None:
    alice, bob = Athlete(), Athlete()
    bench = make_exercise()
    put_sets(alice, put_workout(alice, 0), str(bench.pk), ["80"])

    assert weights(bob.get(f"/exercises/{bench.pk}/last-sets/")) == []
    assert weights(alice.get(f"/exercises/{make_exercise(name='Rowing').pk}/last-sets/")) == []


def test_each_listed_workout_is_summarised_without_warmups() -> None:
    alice = Athlete()
    bench, squat = make_exercise(), make_exercise(name="Squat")
    workout = put_workout(alice, 0)
    empty = put_workout(alice, 1)
    put_sets(alice, workout, str(bench.pk), ["80", "80"])  # 2 x (80 x 8)
    put_sets(alice, workout, str(squat.pk), ["100"])  # 100 x 8
    item_id = str(uuid4())
    body = {"workout_id": workout, "exercise_id": str(squat.pk), "position": 2}
    assert alice.put(f"/workout-exercises/{item_id}/", body).status_code == 201
    warmup = set_body(UUID(item_id), weight_kg="40", is_warmup=True)
    assert alice.put(f"/sets/{uuid4()}/", warmup).status_code == 201

    items = {item["id"]: item for item in alice.get("/workouts/").json()["items"]}

    assert items[workout] | {"started_at": None, "ended_at": None} == {
        "id": workout,
        "started_at": None,
        "ended_at": None,
        "exercise_count": 3,
        "working_set_count": 3,
        "volume_kg": 2080.0,
    }
    assert (items[empty]["exercise_count"], items[empty]["volume_kg"]) == (0, 0.0)
