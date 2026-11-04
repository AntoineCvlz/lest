"""Pesées et mensurations de démo : plan déterministe et commande `seed_body` (dev seulement)."""

from datetime import date
from decimal import Decimal
from io import StringIO
from itertools import pairwise
from typing import Any

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.tests.factories import make_verified_user
from apps.body import demo
from apps.body.models import MAX_WEIGHT_KG, MIN_WEIGHT_KG, BodyMeasurement, BodyWeight

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 4)


def test_weights_cover_eight_weeks_up_to_today_with_a_few_gaps() -> None:
    plan = demo.weights(today=TODAY)

    assert plan[0].day == date(2026, 9, 10)
    assert plan[-1].day == TODAY
    assert demo.DAYS * 0.7 < len(plan) < demo.DAYS
    assert len({one.day for one in plan}) == len(plan)
    assert all(MIN_WEIGHT_KG <= one.weight_kg <= MAX_WEIGHT_KG for one in plan)


def test_the_weight_trend_goes_up() -> None:
    plan = demo.weights(today=TODAY)
    first_week = sum((one.weight_kg for one in plan[:5]), Decimal(0)) / 5
    last_week = sum((one.weight_kg for one in plan[-5:]), Decimal(0)) / 5

    assert last_week - first_week > 1


def test_measurements_every_two_weeks_ending_today() -> None:
    plan = demo.measurements(today=TODAY)
    days = sorted({one.day for one in plan})

    assert days[-1] == TODAY
    assert all((later - earlier).days == demo.MEASURE_EVERY for earlier, later in pairwise(days))
    assert {one.site for one in plan} == set(demo.SITES)


def test_the_plans_are_deterministic() -> None:
    assert demo.weights(today=TODAY) == demo.weights(today=TODAY)
    assert demo.measurements(today=TODAY) == demo.measurements(today=TODAY)


# --- Commande ---------------------------------------------------------------------------------


@pytest.fixture
def dev(settings: Any) -> None:
    settings.DEBUG = True


def seed(**options: Any) -> str:
    out = StringIO()
    call_command("seed_body", stdout=out, **options)
    return out.getvalue()


@pytest.mark.usefixtures("dev")
def test_the_command_fills_the_demo_account_and_can_be_replayed() -> None:
    user = make_verified_user(email="demo@example.com")

    seed()
    counts = (BodyWeight.objects.count(), BodyMeasurement.objects.count())
    seed()

    assert (BodyWeight.objects.count(), BodyMeasurement.objects.count()) == counts
    assert BodyWeight.objects.filter(owner=user).count() == counts[0] > 0
    assert counts[1] > 0


@pytest.mark.usefixtures("dev")
def test_another_account_can_be_seeded_without_touching_the_demo_one() -> None:
    demo_user = make_verified_user(email="demo@example.com")
    other = make_verified_user(email="autre@example.com")

    seed(email="autre@example.com")

    assert BodyWeight.objects.filter(owner=other).exists()
    assert not BodyWeight.objects.filter(owner=demo_user).exists()


def test_the_command_refuses_outside_development(settings: Any) -> None:
    settings.DEBUG = False
    make_verified_user(email="demo@example.com")

    with pytest.raises(CommandError, match="développement"):
        seed()


@pytest.mark.usefixtures("dev")
def test_the_command_needs_the_account() -> None:
    with pytest.raises(CommandError, match="seed_demo"):
        seed()
