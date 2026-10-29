"""Séances et séries (ADR 0003) : écritures idempotentes, volume, isolation entre comptes."""

from typing import Any
from unittest import mock
from uuid import UUID, uuid4

import pytest
from django.db import IntegrityError, connection, transaction
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.training import services
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
    assert WorkoutExercise.objects.filter(pk=item_id).exists()
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


def test_a_persistent_integrity_error_is_a_bounded_opaque_conflict(
    alice: Athlete, bench: Exercise, caplog: pytest.LogCaptureFixture
) -> None:
    _, item_id = start(alice, bench)
    attempts = 0

    def always_violates(self: Set, *args: Any, **kwargs: Any) -> None:
        nonlocal attempts
        attempts += 1
        msg = "Failing row contains (..., 123.45, ...)"
        raise IntegrityError(msg)

    with mock.patch.object(Set, "save", always_violates):
        response = alice.put(f"/sets/{uuid4()}/", set_body(item_id, weight_kg="123.45"))

    assert response.status_code == 409
    assert attempts == 2  # une seule nouvelle tentative
    assert "123.45" not in response.content.decode()
    assert "123.45" not in caplog.text


@pytest.mark.parametrize(
    "workout_id",
    ["00000000-0000-0000-0000-000000000000", "c232ab00-9414-11ec-b3c8-9f6bdeced846"],  # nul, v1
)
def test_only_random_client_ids_are_accepted(alice: Athlete, workout_id: str) -> None:
    response = alice.put(f"/workouts/{workout_id}/", workout_body())

    assert response.status_code == 422
    assert not Workout.objects.exists()


@pytest.mark.parametrize(
    "started_at", ["0001-01-01T00:00:00+14:00", "9999-12-31T23:00:00-05:00", "1999-12-31T12:00:00Z"]
)
def test_implausible_dates_are_refused(alice: Athlete, started_at: str) -> None:
    response = alice.put(f"/workouts/{uuid4()}/", workout_body(started_at=started_at))

    assert response.status_code == 422
    assert not Workout.objects.exists()


def test_a_deactivated_exercise_still_accepts_an_offline_replay(alice: Athlete) -> None:
    retired = make_exercise(is_active=False)

    workout_id, _ = start(alice, retired)

    assert alice.get(f"/workouts/{workout_id}/").json()["exercises"][0]["exercise_id"] == str(
        retired.pk
    )


def miss_the_first_lookup() -> Any:
    """Course : la première lecture ne voit pas la ligne qu'un autre envoi vient d'insérer."""
    original = services._locked
    calls = 0

    def locked(model: Any, pk: UUID) -> Any:
        nonlocal calls
        calls += 1
        return None if calls == 1 else original(model, pk)

    return mock.patch.object(services, "_locked", locked)


def test_two_simultaneous_first_sends_make_one_workout(alice: Athlete) -> None:
    # Double tap : le premier envoi est déjà écrit quand le second l'écrit à son tour.
    workout_id = uuid4()
    Workout.objects.create(id=workout_id, owner=alice.user, started_at=STARTED)

    with miss_the_first_lookup():
        response = alice.put(f"/workouts/{workout_id}/", workout_body())

    assert response.status_code == 200  # rejoué en mise à jour, sans doublon
    assert Workout.objects.filter(pk=workout_id).count() == 1


def test_a_concurrent_first_send_by_another_account_is_not_taken_over(
    alice: Athlete, bob: Athlete
) -> None:
    workout_id = uuid4()
    Workout.objects.create(id=workout_id, owner=bob.user, started_at=STARTED)

    with miss_the_first_lookup():
        response = alice.put(f"/workouts/{workout_id}/", workout_body(ended_at=STARTED))

    assert response.status_code == 404
    bobs = Workout.objects.get(pk=workout_id)
    assert (bobs.owner, bobs.ended_at) == (bob.user, None)


def test_the_parent_is_locked_while_its_child_is_written(alice: Athlete, bench: Exercise) -> None:
    # Une suppression concurrente du parent attend la fin de l'écriture : pas de clé orpheline.
    _, item_id = start(alice, bench)

    with CaptureQueriesContext(connection) as queries:
        alice.put(f"/sets/{uuid4()}/", set_body(item_id))

    assert any(
        'FROM "training_workoutexercise"' in query["sql"] and "FOR UPDATE" in query["sql"]
        for query in queries.captured_queries
    )
