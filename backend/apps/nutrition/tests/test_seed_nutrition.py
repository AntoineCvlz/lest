"""Journal de démo : plan déterministe et commande `seed_nutrition` (dev seulement)."""

from datetime import date
from io import StringIO
from typing import Any

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.tests.factories import make_verified_user
from apps.nutrition import demo, selectors, services
from apps.nutrition.models import MAX_ENTRIES_PER_DAY, Food, JournalEntry, Meal, WaterIntake

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 4)


def test_two_weeks_up_to_today_today_unfinished() -> None:
    plan = demo.plan(today=TODAY)

    assert [day.day for day in plan][-1] == TODAY
    assert len(plan) == demo.DAYS
    assert {entry.meal for entry in plan[-1].entries} == set(demo.TODAY_MEALS)
    assert {entry.meal for entry in plan[0].entries} >= {Meal.BREAKFAST, Meal.LUNCH, Meal.DINNER}
    assert all(0 < len(day.entries) <= MAX_ENTRIES_PER_DAY for day in plan)


def test_ids_are_unique_and_the_plan_is_deterministic() -> None:
    plan = demo.plan(today=TODAY)
    ids = [entry.id for day in plan for entry in day.entries]

    assert len(set(ids)) == len(ids)
    assert all(entry.id.version == 4 for day in plan for entry in day.entries)
    assert plan == demo.plan(today=TODAY)


def test_quantities_vary_but_stay_close_to_the_usual_meal() -> None:
    oats = [
        entry.grams
        for day in demo.plan(today=TODAY)
        for entry in day.entries
        if entry.food_id == demo.FOODS["avoine"].id
    ]

    assert len(set(oats)) > 1
    assert all(80 <= grams <= 120 for grams in oats)


# --- Commande ---------------------------------------------------------------------------------


@pytest.fixture
def dev(settings: Any) -> None:
    settings.DEBUG = True


def seed(**options: Any) -> str:
    out = StringIO()
    call_command("seed_nutrition", stdout=out, **options)
    return out.getvalue()


@pytest.mark.usefixtures("dev")
def test_the_command_fills_the_demo_account_and_can_be_replayed() -> None:
    user = make_verified_user(email="demo@example.com")

    seed()
    counts = (Food.objects.count(), JournalEntry.objects.count(), WaterIntake.objects.count())
    seed()

    assert (
        Food.objects.count(),
        JournalEntry.objects.count(),
        WaterIntake.objects.count(),
    ) == counts
    assert Food.objects.filter(owner=user).count() == len(demo.FOODS)
    assert counts[1] > 0
    assert selectors.targets_view(owner=user).configured


@pytest.mark.usefixtures("dev")
def test_targets_already_set_are_kept() -> None:
    user = make_verified_user(email="demo@example.com")
    services.put_targets(
        owner=user,
        values=services.TargetValues(
            sex="female",
            birth_date=date(1990, 1, 1),
            activity="light",
            kcal=2200,
            protein_g=None,
            carbs_g=None,
            fat_g=None,
        ),
    )

    seed()

    inputs = selectors.targets_view(owner=user).inputs
    assert inputs is not None
    assert (inputs["sex"], inputs["kcal"]) == ("female", 2200)


@pytest.mark.usefixtures("dev")
def test_another_account_can_be_seeded_without_touching_the_demo_one() -> None:
    demo_user = make_verified_user(email="demo@example.com")
    other = make_verified_user(email="autre@example.com")

    seed(email="autre@example.com")

    assert JournalEntry.objects.filter(owner=other).exists()
    assert not JournalEntry.objects.filter(owner=demo_user).exists()


def test_the_command_refuses_outside_development(settings: Any) -> None:
    settings.DEBUG = False
    make_verified_user(email="demo@example.com")

    with pytest.raises(CommandError, match="développement"):
        seed()


@pytest.mark.usefixtures("dev")
def test_the_command_needs_the_account() -> None:
    with pytest.raises(CommandError, match="seed_demo"):
        seed()
