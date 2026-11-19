"""Exercices perso (ADR 0017) : écriture idempotente, isolation stricte entre comptes, plafond,
type figé par l'historique, suppression, export et suppression du compte."""

from typing import Any
from uuid import UUID, uuid4

import pytest

from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.factories import TEST_PASSWORD
from apps.training.models import Equipment, Exercise, Muscle, Workout
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_programs import day, planned_body, program
from apps.training.tests.test_workouts_api import Athlete, set_body, start

pytestmark = pytest.mark.django_db


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


@pytest.fixture
def bob() -> Athlete:
    return Athlete()


def body(**overrides: Any) -> dict[str, Any]:
    defaults = {"name": "Presse à mollets de ma salle", "kind": "weight_reps", "category": "calves"}
    return defaults | overrides


def create(athlete: Athlete, **overrides: Any) -> UUID:
    exercise_id = uuid4()
    response = athlete.put(f"/custom-exercises/{exercise_id}/", body(**overrides))
    assert response.status_code == 201, response.content
    return exercise_id


def test_a_custom_exercise_is_created_then_replaced_idempotently(alice: Athlete) -> None:
    calves = Muscle.objects.create(code="soleus", name="Soléaire", is_front=False)
    machine = Equipment.objects.create(code="calf", name="Machine à mollets")
    exercise_id = uuid4()
    payload = body(name="  Mollets assis  ", muscle_ids=[calves.pk], equipment_ids=[machine.pk])

    created = alice.put(f"/custom-exercises/{exercise_id}/", payload)
    again = alice.put(f"/custom-exercises/{exercise_id}/", payload)

    assert (created.status_code, again.status_code) == (201, 200)
    assert again.json() | {"id": None} == {
        "id": None,
        "name": "Mollets assis",
        "name_language": "fr",
        "category": "calves",
        "kind": "weight_reps",
        "is_custom": True,
        "muscles": [{"id": calves.pk, "name": "Soléaire"}],
        "secondary_muscles": [],
        "equipment": [{"id": machine.pk, "name": "Machine à mollets"}],
        "image": None,
        "images": [],
        "license": "",
        "license_author": "",
        "is_active": True,
    }
    assert Exercise.objects.get(pk=exercise_id).owner == alice.user


def test_custom_exercises_are_listed_for_their_owner_only(alice: Athlete, bob: Athlete) -> None:
    create(alice, name="Mollets assis")
    create(alice, name="Abducteurs", is_active=False)
    create(bob, name="Machine de Bob")
    make_exercise(name="Squat")

    names = [item["name"] for item in alice.get("/custom-exercises/").json()["items"]]

    assert names == ["Abducteurs", "Mollets assis"]


def test_another_account_cannot_see_use_or_change_a_custom_exercise(
    alice: Athlete, bob: Athlete
) -> None:
    exercise_id = create(alice, name="Mollets assis")
    _, item_id = start(bob, make_exercise())
    workout_id = Workout.objects.get(owner=bob.user).pk
    program_day = day(bob, program(bob))

    assert bob.get(f"/exercises/{exercise_id}/").status_code == 404
    assert bob.get("/exercises/?q=mollets").json()["items"] == []
    use_in_workout = bob.put(
        f"/workout-exercises/{uuid4()}/",
        {"workout_id": str(workout_id), "exercise_id": str(exercise_id), "position": 1},
    )
    assert use_in_workout.status_code == 422
    planned = planned_body(program_day, Exercise.objects.get(pk=exercise_id))
    assert bob.put(f"/program-exercises/{uuid4()}/", planned).status_code == 422
    assert bob.put(f"/custom-exercises/{exercise_id}/", body(name="Volé")).status_code == 404
    assert bob.delete(f"/custom-exercises/{exercise_id}/").status_code == 204  # sans effet
    assert Exercise.objects.get(pk=exercise_id).name == "Mollets assis"
    assert item_id  # la séance de Bob est intacte


def test_the_owner_uses_a_custom_exercise_in_workouts_and_programs(alice: Athlete) -> None:
    exercise_id = create(alice)
    exercise = Exercise.objects.get(pk=exercise_id)

    _, item_id = start(alice, exercise)
    planned = planned_body(day(alice, program(alice)), exercise)

    assert alice.put(f"/sets/{uuid4()}/", set_body(item_id)).status_code == 201
    assert alice.put(f"/program-exercises/{uuid4()}/", planned).status_code == 201
    assert alice.get(f"/exercises/{exercise_id}/").json()["is_custom"] is True


def test_the_catalog_and_its_filters_never_show_custom_exercises(
    alice: Athlete, bob: Athlete
) -> None:
    private = Muscle.objects.create(code="private", name="Muscle de Bob", is_front=True)
    create(bob, name="Curl de Bob", muscle_ids=[private.pk])

    assert alice.get("/exercises/?q=curl").json()["items"] == []
    assert bob.get("/exercises/?q=curl").json()["items"] == []
    muscles = alice.get("/exercise-filters/").json()["muscles"]
    assert "Muscle de Bob" not in {muscle["name"] for muscle in muscles}


def test_a_catalog_exercise_cannot_be_overwritten(alice: Athlete) -> None:
    catalog = make_exercise(name="Squat")

    assert alice.put(f"/custom-exercises/{catalog.pk}/", body()).status_code == 404
    assert alice.delete(f"/custom-exercises/{catalog.pk}/").status_code == 204
    assert Exercise.objects.get(pk=catalog.pk).name == "Squat"


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},
        {"name": "x" * 81},
        {"kind": "laps"},
        {"category": "neck"},
        {"muscle_ids": [0]},
        {"equipment_ids": list(range(1, 12))},
    ],
)
def test_invalid_values_are_refused(alice: Athlete, overrides: dict[str, Any]) -> None:
    assert alice.put(f"/custom-exercises/{uuid4()}/", body(**overrides)).status_code == 422


def test_an_unknown_muscle_or_equipment_is_refused(alice: Athlete) -> None:
    response = alice.put(f"/custom-exercises/{uuid4()}/", body(muscle_ids=[999_999]))

    assert response.status_code == 422
    assert response.json()["errors"] == [{"loc": ["muscle_ids"], "type": "unknown"}]


def test_an_account_has_at_most_300_custom_exercises(
    alice: Athlete, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("apps.training.services.MAX_CUSTOM_EXERCISES", 2)
    first = create(alice)
    create(alice)

    refused = alice.put(f"/custom-exercises/{uuid4()}/", body())

    assert refused.status_code == 422
    assert refused.json()["errors"] == [{"loc": ["exercise_id"], "type": "too_many"}]
    # Modifier un exercice existant reste possible au plafond.
    assert alice.put(f"/custom-exercises/{first}/", body(name="Renommé")).status_code == 200


def test_the_kind_is_locked_once_the_exercise_is_used(alice: Athlete) -> None:
    exercise_id = create(alice, kind="reps")
    assert alice.put(f"/custom-exercises/{exercise_id}/", body(kind="duration")).status_code == 200
    start(alice, Exercise.objects.get(pk=exercise_id))

    locked = alice.put(f"/custom-exercises/{exercise_id}/", body(kind="weight_reps"))

    assert locked.status_code == 422
    assert locked.json()["errors"] == [{"loc": ["kind"], "type": "locked"}]
    renamed = alice.put(f"/custom-exercises/{exercise_id}/", body(kind="duration", name="Gainage"))
    assert renamed.status_code == 200


def test_a_used_custom_exercise_is_archived_not_deleted(alice: Athlete) -> None:
    unused = create(alice)
    used = create(alice)
    start(alice, Exercise.objects.get(pk=used))

    assert alice.delete(f"/custom-exercises/{unused}/").status_code == 204
    refused = alice.delete(f"/custom-exercises/{used}/")

    assert refused.status_code == 409
    assert refused.json()["type"] == "urn:lest:problem:exercise-in-use"
    assert not Exercise.objects.filter(pk=unused).exists()
    assert alice.put(f"/custom-exercises/{used}/", body(is_active=False)).status_code == 200


def test_custom_exercises_are_exported(alice: Athlete, bob: Athlete) -> None:
    create(alice, name="Mollets assis", kind="reps", category="calves")
    create(bob, name="Machine de Bob")

    exported = export_account(alice.user)["custom_exercises"]

    assert [(row["name"], row["kind"], row["category"]) for row in exported] == [
        ("Mollets assis", "reps", "calves")
    ]


def test_deleting_the_account_deletes_its_used_custom_exercises(alice: Athlete) -> None:
    exercise_id = create(alice)
    _, item_id = start(alice, Exercise.objects.get(pk=exercise_id))
    assert alice.put(f"/sets/{uuid4()}/", set_body(item_id)).status_code == 201
    program_day = day(alice, program(alice))
    planned = planned_body(program_day, Exercise.objects.get(pk=exercise_id))
    assert alice.put(f"/program-exercises/{uuid4()}/", planned).status_code == 201

    delete_account(user=alice.user, password=TEST_PASSWORD)

    assert not Exercise.objects.filter(pk=exercise_id).exists()
