from unittest.mock import patch

import pytest
from django.test import Client

from common.health.selectors import HealthReport

URL = "/api/v1/health/"


@pytest.mark.django_db
def test_health_ok(client: Client) -> None:
    response = client.get(URL)

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": "ok", "cache": "ok"}}


def test_health_degraded_returns_503_without_error_details(client: Client) -> None:
    with patch(
        "common.health.api.get_health_report",
        return_value=HealthReport(database=False, cache=True),
    ):
        response = client.get(URL)

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "checks": {"database": "down", "cache": "ok"}}


def test_health_is_documented_in_openapi(client: Client) -> None:
    schema = client.get("/api/v1/openapi.json").json()

    assert set(schema["paths"][URL]["get"]["responses"]) == {"200", "503"}
