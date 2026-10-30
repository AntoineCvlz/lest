"""Records (CLAUDE.md) : détectés à l'enregistrement d'une série, historisés, recalculés."""

from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from apps.accounts.selectors import export_account
from apps.training import selectors, services
from apps.training.models import Exercise, PersonalRecord
from apps.training.one_rep_max import BRZYCKI, EPLEY, estimate_one_rep_max
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_workouts_api import Athlete, set_body, start

pytestmark = pytest.mark.django_db


def put_set(athlete: Athlete, item_id: UUID, minute: int, **overrides: Any) -> Any:
    """Série faite à 18 h `minute` (l'ordre réel des séries décide des records)."""
    set_id = overrides.pop("set_id", uuid4())
    body = set_body(item_id, performed_at=f"2026-10-29T18:{minute:02d}:00+01:00", **overrides)
    response = athlete.put(f"/sets/{set_id}/", body)
    assert response.status_code in (200, 201), response.content
    return response.json()


def history(athlete: Athlete, exercise: Exercise) -> list[tuple[str, float]]:
    records = athlete.get(f"/exercises/{exercise.pk}/records/").json()["history"]
    return [(record["kind"], record["value_kg"]) for record in records]


@pytest.fixture
def alice() -> Athlete:
    return Athlete()


@pytest.fixture
def bench() -> Exercise:
    return make_exercise()


# --- Formules -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("weight", "reps", "formula", "expected"),
    [
        ("100", 1, EPLEY, "100.00"),
        ("100", 5, EPLEY, "116.67"),
        ("80", 12, EPLEY, "112.00"),
        ("80", 13, EPLEY, None),  # au-delà de 12 : pas d'estimation
        ("100", 1, BRZYCKI, "100.00"),
        ("100", 5, BRZYCKI, "112.50"),
        ("80", 10, BRZYCKI, "106.67"),
        ("80", 11, BRZYCKI, None),  # au-delà de 10
        ("100", 0, EPLEY, None),
        ("0", 5, EPLEY, None),  # poids du corps : pas de charge
    ],
)
def test_one_rep_max_estimates(weight: str, reps: int, formula: str, expected: str | None) -> None:
    estimate = estimate_one_rep_max(Decimal(weight), reps, formula)

    assert estimate == (Decimal(expected) if expected else None)


# --- Détection et historique ----------------------------------------------------------------


def test_a_set_announces_the_records_it_sets(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)

    first = put_set(alice, item_id, 5, weight_kg="80", reps=5)
    lighter = put_set(alice, item_id, 8, weight_kg="70", reps=5)

    assert sorted(record["kind"] for record in first["records"]) == ["e1rm", "weight"]
    assert lighter["records"] == []


def test_records_are_historised_in_the_order_sets_were_done(
    alice: Athlete, bench: Exercise
) -> None:
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)  # 1RM 93,33
    put_set(alice, item_id, 8, weight_kg="85", reps=2)  # 1RM 90,67 : record de charge seulement
    put_set(alice, item_id, 12, weight_kg="82.5", reps=6)  # 1RM 99 : record de 1RM seulement

    assert history(alice, bench) == [
        ("e1rm", 93.33),
        ("weight", 80.0),
        ("weight", 85.0),
        ("e1rm", 99.0),
    ]


def test_warm_up_and_ties_set_no_record(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 1, weight_kg="100", reps=5, is_warmup=True)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)

    tie = put_set(alice, item_id, 8, weight_kg="80", reps=5)

    assert tie["records"] == []  # égaler n'est pas battre
    assert history(alice, bench) == [("e1rm", 93.33), ("weight", 80.0)]


def test_replaying_a_set_gives_the_same_records(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    set_id = uuid4()

    first = put_set(alice, item_id, 5, set_id=set_id, weight_kg="80", reps=5)
    replayed = put_set(alice, item_id, 5, set_id=set_id, weight_kg="80", reps=5)

    assert first["records"] == replayed["records"]
    assert PersonalRecord.objects.count() == 2


def test_lowering_or_deleting_a_set_withdraws_its_record(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)
    typo = uuid4()
    put_set(alice, item_id, 8, set_id=typo, weight_kg="800", reps=5)  # faute de frappe

    put_set(alice, item_id, 8, set_id=typo, weight_kg="80", reps=4)  # corrigée
    assert history(alice, bench) == [("e1rm", 93.33), ("weight", 80.0)]

    alice.delete(f"/sets/{typo}/")
    alice.delete(f"/workout-exercises/{item_id}/")
    assert history(alice, bench) == []


def test_changing_the_exercise_moves_its_records(alice: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)
    squat = make_exercise(name="Squat", category="legs")

    alice.put(
        f"/workout-exercises/{item_id}/",
        {"workout_id": str(workout_id), "exercise_id": str(squat.pk), "position": 0},
    )

    assert history(alice, bench) == []
    assert history(alice, squat) == [("e1rm", 93.33), ("weight", 80.0)]


def test_deleting_the_workout_withdraws_its_records(alice: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)

    alice.delete(f"/workouts/{workout_id}/")

    assert not PersonalRecord.objects.exists()


# --- Formule du profil ----------------------------------------------------------------------


def profile(athlete: Athlete, **overrides: Any) -> Any:
    body = {"height_m": 1.8, "goal": "gain", "unit_system": "metric", **overrides}
    return athlete.put("/me/profile/", body)


def test_the_profile_formula_recomputes_the_estimates(alice: Athlete, bench: Exercise) -> None:
    profile(alice)
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="100", reps=5)
    assert history(alice, bench) == [("e1rm", 116.67), ("weight", 100.0)]

    response = profile(alice, one_rm_formula="brzycki")

    assert response.json()["one_rm_formula"] == "brzycki"
    assert history(alice, bench) == [("e1rm", 112.5), ("weight", 100.0)]


def test_saving_the_profile_without_formula_keeps_it(alice: Athlete) -> None:
    profile(alice, one_rm_formula="brzycki")

    response = profile(alice, goal="cut")  # formulaire de profil : pas de formule envoyée

    assert response.json()["one_rm_formula"] == "brzycki"


def test_the_formula_defaults_to_epley(alice: Athlete) -> None:
    assert profile(alice).json()["one_rm_formula"] == "epley"
    assert profile(alice, one_rm_formula="lombardi").status_code == 422


# --- Isolation et RGPD ----------------------------------------------------------------------


def test_bob_never_sees_alice_records(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)
    bob = Athlete()
    _, bob_item = start(bob, bench)
    put_set(bob, bob_item, 5, weight_kg="40", reps=5)

    assert history(bob, bench) == [("e1rm", 46.67), ("weight", 40.0)]
    assert history(alice, bench) == [("e1rm", 93.33), ("weight", 80.0)]


def test_records_join_the_export(alice: Athlete, bench: Exercise) -> None:
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="80", reps=5)

    records = export_account(alice.user)["personal_records"]

    assert [(record["kind"], record["value_kg"]) for record in records] == [
        ("e1rm", 93.33),
        ("weight", 80.0),
    ]
    assert records[0]["exercise"] == "Développé couché"


# --- Revue de sécurité : isolation des écritures, verrou, plafonds --------------------------


def snapshot(owner: Any) -> list[tuple[Any, ...]]:
    return list(PersonalRecord.objects.filter(owner=owner).values_list("id", "kind", "value_kg"))


def test_bob_writes_never_touch_alice_records(alice: Athlete, bench: Exercise) -> None:
    workout_id, item_id = start(alice, bench)
    set_id = uuid4()
    put_set(alice, item_id, 5, set_id=set_id, weight_kg="80", reps=5)
    before = snapshot(alice.user)
    bob = Athlete()
    _, bob_item = start(bob, bench)

    assert bob.put(f"/sets/{set_id}/", set_body(bob_item, weight_kg="300")).status_code == 404
    bob.delete(f"/sets/{set_id}/")
    bob.delete(f"/workout-exercises/{item_id}/")
    bob.delete(f"/workouts/{workout_id}/")
    profile(bob, one_rm_formula="brzycki")

    assert snapshot(alice.user) == before


def test_a_formula_change_leaves_heaviest_records_alone(alice: Athlete, bench: Exercise) -> None:
    profile(alice)
    _, item_id = start(alice, bench)
    put_set(alice, item_id, 5, weight_kg="100", reps=5)
    heaviest = PersonalRecord.objects.get(kind="weight").pk

    profile(alice, one_rm_formula="brzycki")

    assert PersonalRecord.objects.get(kind="weight").pk == heaviest  # même ligne, non recréée


def test_recomputing_records_locks_the_account(alice: Athlete, bench: Exercise) -> None:
    # Deux appareils qui écrivent en même temps se succèdent au lieu de mêler leurs records.
    _, item_id = start(alice, bench)

    with CaptureQueriesContext(connection) as queries:
        put_set(alice, item_id, 5, weight_kg="80", reps=5)

    assert any(
        'FROM "accounts_user"' in query["sql"] and "FOR UPDATE" in query["sql"]
        for query in queries.captured_queries
    )


def test_an_exercise_holds_a_bounded_number_of_sets(
    alice: Athlete, bench: Exercise, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(services, "MAX_SETS_PER_EXERCISE", 2)
    _, item_id = start(alice, bench)
    kept = uuid4()
    put_set(alice, item_id, 1, set_id=kept, weight_kg="80", reps=5)
    put_set(alice, item_id, 2, weight_kg="80", reps=5)

    third = alice.put(f"/sets/{uuid4()}/", set_body(item_id))

    assert third.status_code == 422
    assert third.json()["errors"] == [{"loc": ["workout_exercise_id"], "type": "too_many"}]
    put_set(alice, item_id, 1, set_id=kept, weight_kg="82.5", reps=5)  # remplacer reste permis


def test_a_workout_holds_a_bounded_number_of_exercises(
    alice: Athlete, bench: Exercise, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(services, "MAX_EXERCISES_PER_WORKOUT", 1)
    workout_id, _ = start(alice, bench)

    second = alice.put(
        f"/workout-exercises/{uuid4()}/",
        {"workout_id": str(workout_id), "exercise_id": str(bench.pk), "position": 1},
    )

    assert second.status_code == 422
    assert second.json()["errors"] == [{"loc": ["workout_id"], "type": "too_many"}]


def test_workout_writes_are_rate_limited_per_account(alice: Athlete) -> None:
    cache.clear()
    limits = {**settings.ACCOUNT_RATE_LIMITS, "training_write": "2/m/user"}
    with override_settings(ACCOUNT_RATE_LIMITS=limits):
        statuses = [
            alice.put(
                f"/workouts/{uuid4()}/", {"started_at": "2026-10-29T18:00:00+01:00"}
            ).status_code
            for _ in range(3)
        ]
        reads = alice.get(f"/exercises/{uuid4()}/records/").status_code

    assert statuses == [201, 201, 429]
    assert reads == 200  # les lectures ne comptent pas


def test_the_history_is_bounded_to_the_latest_records(
    alice: Athlete, bench: Exercise, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(selectors, "MAX_HISTORY", 2)
    _, item_id = start(alice, bench)
    for minute, weight in enumerate(("60", "70", "80"), start=1):
        put_set(alice, item_id, minute, weight_kg=weight, reps=13)  # charge seule : pas de 1RM

    assert history(alice, bench) == [("weight", 70.0), ("weight", 80.0)]
