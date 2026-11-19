"""Séances de cardio de démo : plan déterministe et commande `seed_cardio` (dev seulement)."""

from datetime import date
from io import StringIO
from typing import Any

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.tests.factories import make_verified_user
from apps.training import cardio_demo
from apps.training.models import PersonalRecord, Workout

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 5)


def test_the_plan_is_stable_and_stays_before_today() -> None:
    plan = cardio_demo.plan(today=TODAY)

    assert plan
    assert all(one.values.started_at.date() < TODAY for one in plan)
    assert {one.values.sport for one in plan} == {"running", "swimming"}
    assert len({one.id for one in plan}) == len(plan)
    assert plan == cardio_demo.plan(today=TODAY)


def seed(**options: Any) -> str:
    out = StringIO()
    call_command("seed_cardio", stdout=out, **options)
    return out.getvalue()


def test_the_command_fills_the_demo_account_and_can_be_replayed(settings: Any) -> None:
    settings.DEBUG = True
    user = make_verified_user(email="demo@example.com")

    seed()
    count = Workout.objects.filter(owner=user).count()
    seed()

    assert count > 0
    assert Workout.objects.count() == count
    assert all(workout.ended_at for workout in Workout.objects.filter(owner=user))
    kinds = set(PersonalRecord.objects.filter(owner=user).values_list("kind", flat=True))
    assert kinds == {"distance", "duration"}


def test_the_command_refuses_outside_development_or_without_the_account(settings: Any) -> None:
    settings.DEBUG = True
    with pytest.raises(CommandError, match="seed_demo"):
        seed()
    settings.DEBUG = False
    make_verified_user(email="demo@example.com")
    with pytest.raises(CommandError, match="développement"):
        seed()
