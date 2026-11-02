"""Séances de démo : plan déterministe et commande `seed_training` (dev seulement)."""

from datetime import date
from io import StringIO
from typing import Any

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.tests.factories import make_verified_user
from apps.training import demo
from apps.training.models import PersonalRecord, Set, Workout
from apps.training.tests.factories import make_exercise

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 2)  # un lundi


def test_the_plan_covers_eight_weeks_three_sessions_each_in_the_past() -> None:
    workouts = demo.plan(today=TODAY)

    assert len(workouts) == demo.WEEKS * len(demo.DAYS)
    assert all(workout.started_at.date() < TODAY for workout in workouts)
    assert {workout.started_at.weekday() for workout in workouts} == set(demo.DAYS)


def test_no_session_is_planned_today_or_later() -> None:
    wednesday = date(2026, 11, 4)

    assert all(workout.started_at.date() < wednesday for workout in demo.plan(today=wednesday))


def test_the_plan_is_deterministic() -> None:
    first, again = demo.plan(today=TODAY), demo.plan(today=TODAY)

    assert first == again


def test_loads_progress_with_a_deload_week() -> None:
    bench = [
        max(one.weight_kg for one in workout.exercises[0].sets)
        for workout in demo.plan(today=TODAY)
        if workout.exercises[0].source_id == "bench-press"
    ]

    assert bench[0] < bench[3]
    assert bench[4] == bench[3]  # décharge à mi-parcours
    assert bench[-1] > bench[3]


def test_compound_lifts_start_with_a_lighter_warm_up_set() -> None:
    first = demo.plan(today=TODAY)[0].exercises[0]

    warmup, *working = first.sets
    assert warmup.is_warmup
    assert warmup.rpe is None
    assert all(warmup.weight_kg < one.weight_kg for one in working)


# --- Commande ---------------------------------------------------------------------------------


@pytest.fixture
def catalog() -> None:
    for source_id in demo.SOURCE_IDS:
        make_exercise(name=source_id, source_id=source_id)


@pytest.fixture
def dev(settings: Any) -> None:
    settings.DEBUG = True


def seed(**options: Any) -> str:
    out = StringIO()
    call_command("seed_training", stdout=out, **options)
    return out.getvalue()


@pytest.mark.usefixtures("catalog", "dev")
def test_the_command_fills_the_demo_account_and_can_be_replayed() -> None:
    user = make_verified_user(email="demo@example.com")

    seed()
    counts = (Workout.objects.filter(owner=user).count(), Set.objects.count())
    seed()

    assert (Workout.objects.filter(owner=user).count(), Set.objects.count()) == counts
    assert counts[0] > 0
    # Records détectés comme à la saisie, par les mêmes services.
    assert PersonalRecord.objects.filter(owner=user).exists()


@pytest.mark.usefixtures("catalog", "dev")
def test_another_account_can_be_seeded_without_touching_the_demo_one() -> None:
    demo_user = make_verified_user(email="demo@example.com")
    other = make_verified_user(email="autre@example.com")

    seed(email="autre@example.com")

    assert Workout.objects.filter(owner=other).exists()
    assert not Workout.objects.filter(owner=demo_user).exists()


@pytest.mark.usefixtures("catalog")
def test_the_command_refuses_outside_development(settings: Any) -> None:
    settings.DEBUG = False
    make_verified_user(email="demo@example.com")

    with pytest.raises(CommandError, match="développement"):
        seed()


@pytest.mark.usefixtures("dev")
def test_the_command_needs_the_account_and_the_catalog() -> None:
    with pytest.raises(CommandError, match="seed_demo"):
        seed()

    make_verified_user(email="demo@example.com")
    with pytest.raises(CommandError, match="import_exercises"):
        seed()
