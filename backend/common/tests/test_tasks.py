from datetime import timedelta

import pytest
from celery.schedules import crontab
from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.utils import timezone

from common.tasks import clear_expired_sessions, ping


def test_ping_task_runs_through_celery() -> None:
    assert ping.delay().get(timeout=1) == "pong"


@pytest.mark.django_db
def test_expired_sessions_are_cleared_and_live_ones_kept() -> None:
    expired, live = SessionStore(), SessionStore()
    for store in (expired, live):
        store["defi"] = "x"
        store.save()
    Session.objects.filter(session_key=expired.session_key).update(
        expire_date=timezone.now() - timedelta(seconds=1)
    )

    clear_expired_sessions.delay().get(timeout=1)

    assert list(Session.objects.values_list("session_key", flat=True)) == [live.session_key]


def test_expired_sessions_are_cleared_daily() -> None:
    entry = settings.CELERY_BEAT_SCHEDULE["clear-expired-sessions"]

    assert entry["task"] == clear_expired_sessions.name
    assert entry["schedule"] == crontab(hour=4, minute=0)
