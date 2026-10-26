from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.db import OperationalError, connection

from common.health import selectors


@pytest.mark.django_db
def test_check_database_ok() -> None:
    assert selectors.check_database() is True


@pytest.mark.django_db
def test_check_database_down_returns_false() -> None:
    with patch.object(connection, "cursor", side_effect=OperationalError("down")):
        assert selectors.check_database() is False


def test_check_cache_ok() -> None:
    assert selectors.check_cache() is True


def test_check_cache_down_returns_false() -> None:
    with patch.object(cache, "set", side_effect=ConnectionError("down")):
        assert selectors.check_cache() is False


def test_check_cache_returns_false_when_value_is_not_read_back() -> None:
    with patch.object(cache, "get", return_value=None):
        assert selectors.check_cache() is False


@pytest.mark.parametrize(
    ("database", "cache", "healthy"),
    [(True, True, True), (False, True, False), (True, False, False), (False, False, False)],
)
def test_report_is_healthy_only_when_every_component_is_up(
    database: bool, cache: bool, healthy: bool
) -> None:
    with (
        patch.object(selectors, "check_database", return_value=database),
        patch.object(selectors, "check_cache", return_value=cache),
    ):
        report = selectors.get_health_report()

    assert report == selectors.HealthReport(database=database, cache=cache)
    assert report.healthy is healthy
