"""Séances et séries (ADR 0003) : écritures idempotentes, volume, isolation entre comptes."""

from typing import Any
from unittest import mock
from uuid import UUID, uuid4

import pytest
from django.db import IntegrityError, transaction
from django.test import Client
from django.utils import timezone

from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.training.models import Exercise, Set, Workout, WorkoutExercise
from apps.training.tests.factories import make_exercise

pytestmark = pytest.mark.django_db

API = "/api/v1"
STARTED = "2026-10-29T18:00:00+01:00"


class Athlete:
    """Un compte connecté et ses appels à l'API."""

    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def put(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.put(
            f"{API}{path}", body, content_type="application/json", headers=self.headers
        )

    def get(self, path: str) -> Any:
        return self.client.get(f"{API}{path}", headers=self.headers)

    def delete(self, path: str) -> Any:
        return self.client.delete(f"{API}{path}", headers=self.headers)


def workout_body(**overrides: Any) -> dict[str, Any]:
    return {"started_at": STARTED, **overrides}


def set_body(workout_exercise_id: UUID, **overrides: Any) -> dict[str, Any]:
    return {
        "workout_exercise_id": str(workout_exercise_id),
        "position": 0,
        "weight_kg": "80",
        "reps": 8,
        "rpe": 8.5,
        "is_warmup": False,
        "performed_at": "2026-10-29T18:05:00+01:00",
        **overrides,
    }


def start(athlete: Athlete, exercise: Exercise) -> tuple[UUID, UUID]:
    """Une séance et un exercice de séance ; renvoie leurs identifiants."""
    workout_id, item_id = uuid4(), uuid4()
    assert athlete.put(f"/workouts/{workout_id}/", workout_body()).status_code == 201
    created = athlete.put(
        f"/workout-exercises/{item_id}/",
        {"workout_id": str(workout_id), "exercise_id": str(exercise.pk), "position": 0},
    )
    assert created.status_code == 201, created.content
    return workout_id, item_id


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


@pytest.fixture
def bob() -> Athlete:
    return Athlete()


@pytest.fixture
def bench() -> Exercise:
    return make_exercise()


# --- Idempotence ----------------------------------------------------------------------------


def test_a_replayed_set_is_written_once(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    set_id = uuid4()

    first = alice.put(f"/sets/{set_id}/", set_body(item_id))
    replayed = alice.put(f"/sets/{set_id}/", set_body(item_id))

    assert (first.status_code, replayed.status_code) == (201, 200)
    assert first.json() == replayed.json()
    assert Set.objects.count() == 1


def test_a_put_replaces_the_set(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    set_id = uuid4()
    alice.put(f"/sets/{set_id}/", set_body(item_id))

    response = alice.put(f"/sets/{set_id}/", set_body(item_id, weight_kg="82.5", reps=6, rpe=None))

    assert response.status_code == 200
    assert (response.json()["weight_kg"], response.json()["reps"]) == (82.5, 6)
    assert response.json()["rpe"] is None


def test_deleting_twice_is_harmless(alice: Athlete, bench: Exercise) -> None:
    workout_id, _ = start(alice, bench)

    assert alice.delete(f"/workouts/{workout_id}/").status_code == 204
    assert alice.delete(f"/workouts/{workout_id}/").status_code == 204
    assert not Workout.objects.exists()
    assert not WorkoutExercise.objects.exists()


def test_a_set_before_its_exercise_is_refused_then_replayed(alice: Athlete) -> None:
    item_id = uuid4()

    response = alice.put(f"/sets/{uuid4()}/", set_body(item_id))

    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["workout_exercise_id"], "type": "unknown"}]
    assert not Set.objects.exists()


def test_an_unknown_exercise_is_refused(alice: Athlete) -> None:
    workout_id = uuid4()
    alice.put(f"/workouts/{workout_id}/", workout_body())

    response = alice.put(
        f"/workout-exercises/{uuid4()}/",
        {"workout_id": str(workout_id), "exercise_id": str(uuid4()), "position": 0},
    )

    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["exercise_id"], "type": "unknown"}]


# --- Lecture et volume ----------------------------------------------------------------------


def test_the_volume_counts_working_sets_only(alice: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    alice.put(f"/sets/{uuid4()}/", set_body(item_id, weight_kg="40", reps=10, is_warmup=True))
    alice.put(f"/sets/{uuid4()}/", set_body(item_id, position=1, weight_kg="80", reps=8))
    alice.put(f"/sets/{uuid4()}/", set_body(item_id, position=2, weight_kg="82.5", reps=6))

    workout = alice.get(f"/workouts/{workout_id}/").json()

    assert workout["volume_kg"] == 80 * 8 + 82.5 * 6  # échauffement exclu
    [exercise] = workout["exercises"]
    assert exercise["exercise_name"] == "Développé couché"
    assert [one["position"] for one in exercise["sets"]] == [0, 1, 2]


def test_an_empty_workout_has_no_volume(alice: Athlete) -> None:
    workout_id = uuid4()
    alice.put(f"/workouts/{workout_id}/", workout_body())

    assert alice.get(f"/workouts/{workout_id}/").json()["volume_kg"] == 0


# --- Validation -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"rpe": 11},
        {"rpe": 7.3},  # par demi-points seulement
        {"weight_kg": "-1"},
        {"weight_kg": "1000.01"},
        {"reps": 1001},
        {"reps": "8"},  # strict : pas de chaîne
        {"performed_at": "2026-10-29T18:05:00"},  # heure sans fuseau
    ],
)
def test_an_invalid_set_is_refused(
    alice: Athlete, bench: Exercise, overrides: dict[str, Any]
) -> None:
    _, item_id = start(alice, bench)

    response = alice.put(f"/sets/{uuid4()}/", set_body(item_id, **overrides))

    assert response.status_code == 422
    assert not Set.objects.exists()


def test_a_workout_cannot_end_before_it_starts(alice: Athlete) -> None:
    response = alice.put(
        f"/workouts/{uuid4()}/", workout_body(ended_at="2026-10-29T17:00:00+01:00")
    )

    assert response.status_code == 422
    assert not Workout.objects.exists()


def test_the_database_refuses_an_out_of_range_rpe(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)

    with pytest.raises(IntegrityError), transaction.atomic():
        Set.objects.create(
            id=uuid4(),
            workout_exercise_id=item_id,
            position=0,
            weight_kg=80,
            reps=8,
            rpe=12,
            performed_at=timezone.now(),
        )


# --- Isolation (B ne lit ni n'écrit jamais les données de A) -------------------------------


def test_bob_cannot_read_alice_workout(alice: Athlete, bob: Athlete, bench: Exercise) -> None:
    workout_id, _ = start(alice, bench)

    assert bob.get(f"/workouts/{workout_id}/").status_code == 404


def test_bob_cannot_overwrite_alice_ids(alice: Athlete, bob: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    set_id = uuid4()
    alice.put(f"/sets/{set_id}/", set_body(item_id))
    bob_workout, bob_item = start(bob, bench)

    responses = [
        bob.put(f"/workouts/{workout_id}/", workout_body(ended_at=STARTED)),
        bob.put(
            f"/workout-exercises/{item_id}/",
            {"workout_id": str(bob_workout), "exercise_id": str(bench.pk), "position": 3},
        ),
        bob.put(f"/sets/{set_id}/", set_body(bob_item, weight_kg="1")),
    ]

    assert [response.status_code for response in responses] == [404, 404, 404]
    assert Workout.objects.get(pk=workout_id).ended_at is None
    assert WorkoutExercise.objects.get(pk=item_id).workout_id == workout_id
    assert Set.objects.get(pk=set_id).weight_kg == 80


def test_bob_cannot_attach_to_alice_parents(alice: Athlete, bob: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)

    into_workout = bob.put(
        f"/workout-exercises/{uuid4()}/",
        {"workout_id": str(workout_id), "exercise_id": str(bench.pk), "position": 1},
    )
    into_exercise = bob.put(f"/sets/{uuid4()}/", set_body(item_id))

    # Même réponse qu'un parent inconnu : rien ne confirme que l'identifiant existe.
    assert (into_workout.status_code, into_exercise.status_code) == (422, 422)
    assert WorkoutExercise.objects.filter(workout_id=workout_id).count() == 1
    assert not Set.objects.exists()


def test_bob_cannot_delete_alice_data(alice: Athlete, bob: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    set_id = uuid4()
    alice.put(f"/sets/{set_id}/", set_body(item_id))

    statuses = [
        bob.delete(f"/sets/{set_id}/").status_code,
        bob.delete(f"/workout-exercises/{item_id}/").status_code,
        bob.delete(f"/workouts/{workout_id}/").status_code,
    ]

    assert statuses == [204, 204, 204]  # idempotent, sans rien révéler
    assert Set.objects.filter(pk=set_id).exists()
    assert Workout.objects.filter(pk=workout_id).exists()


def test_routes_require_authentication(bench: Exercise) -> None:
    response = Client().put(
        f"{API}/workouts/{uuid4()}/", workout_body(), content_type="application/json"
    )

    assert response.status_code == 401


# --- RGPD -----------------------------------------------------------------------------------


def test_the_export_contains_the_workouts(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    alice.put(f"/sets/{uuid4()}/", set_body(item_id))

    [workout] = export_account(alice.user)["workouts"]

    assert workout["exercises"][0]["exercise"] == "Développé couché"
    assert workout["exercises"][0]["sets"][0] | {"performed_at": None} == {
        "weight_kg": 80.0,
        "reps": 8,
        "rpe": 8.5,
        "is_warmup": False,
        "performed_at": None,
    }


def test_deleting_the_account_deletes_its_workouts(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    alice.put(f"/sets/{uuid4()}/", set_body(item_id))

    delete_account(user=alice.user, password=TEST_PASSWORD)

    assert not Workout.objects.exists()
    assert not Set.objects.exists()
    assert Exercise.objects.filter(pk=bench.pk).exists()  # le catalogue reste


def test_two_simultaneous_first_sends_make_one_workout(alice: Athlete) -> None:
    # Double tap : le premier envoi insère la séance après la lecture du second (simulé pendant
    # sa validation). Le second rencontre l'unicité de la clé et devient une mise à jour.
    workout_id = uuid4()
    original_full_clean = Workout.full_clean
    raced = False

    def full_clean_then_concurrent_insert(self: Workout, *args: Any, **kwargs: Any) -> None:
        nonlocal raced
        original_full_clean(self, *args, **kwargs)
        if not raced:
            raced = True
            Workout.objects.bulk_create(
                [Workout(pk=self.pk, owner=self.owner, started_at=self.started_at)]
            )

    with mock.patch.object(Workout, "full_clean", full_clean_then_concurrent_insert):
        response = alice.put(f"/workouts/{workout_id}/", workout_body())

    assert response.status_code == 200  # rejoué en mise à jour
    assert Workout.objects.filter(pk=workout_id).count() == 1
