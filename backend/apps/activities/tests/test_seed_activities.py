"""Activités de démo : plan déterministe et commande `seed_activities` (dev seulement)."""

from datetime import date
from io import StringIO
from typing import Any

import pytest
from django.core.management import CommandError, call_command

from apps.accounts.tests.factories import make_verified_user
from apps.activities import demo
from apps.activities.models import Activity
from apps.activities.sports import SPORTS

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 5)


def test_the_plan_respects_the_catalog_and_stays_before_today() -> None:
    plan = demo.plan(today=TODAY)

    assert plan
    assert all(one.day < TODAY for one in plan)
    assert {one.sport for one in plan} == {"running", "swimming"}
    for one in plan:
        sport = SPORTS[one.sport]
        for key, value in one.metrics.items():
            metric = sport.metric(key)
            assert metric is not None
            assert metric.minimum <= value <= metric.maximum
    assert len({one.id for one in plan}) == len(plan)
    assert plan == demo.plan(today=TODAY)


def seed(**options: Any) -> str:
    out = StringIO()
    call_command("seed_activities", stdout=out, **options)
    return out.getvalue()


def test_the_command_fills_the_demo_account_and_can_be_replayed(settings: Any) -> None:
    settings.DEBUG = True
    user = make_verified_user(email="demo@example.com")

    seed()
    count = Activity.objects.filter(owner=user).count()
    seed()

    assert count > 0
    assert Activity.objects.count() == count


def test_the_command_refuses_outside_development_or_without_the_account(settings: Any) -> None:
    settings.DEBUG = True
    with pytest.raises(CommandError, match="seed_demo"):
        seed()
    settings.DEBUG = False
    make_verified_user(email="demo@example.com")
    with pytest.raises(CommandError, match="développement"):
        seed()
