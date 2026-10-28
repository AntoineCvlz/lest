from typing import NoReturn

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404, HttpRequest
from django.test import Client
from ninja import NinjaAPI, Schema
from ninja.testing import TestClient

from common.problems import PROBLEM_CONTENT_TYPE, register_problem_handlers


class WeightIn(Schema):
    kg: float


def _build_client() -> TestClient:
    api = NinjaAPI(urls_namespace="problems-test")
    register_problem_handlers(api)

    @api.get("/missing")
    def missing(request: HttpRequest) -> NoReturn:
        raise Http404("Secret interne")

    @api.get("/conflict")
    def conflict(request: HttpRequest) -> NoReturn:
        from ninja.errors import HttpError

        raise HttpError(409, "Cette séance est déjà terminée.")

    @api.post("/weights")
    def weights(request: HttpRequest, payload: WeightIn) -> dict[str, float]:
        return {"kg": payload.kg}

    @api.get("/boom")
    def boom(request: HttpRequest) -> NoReturn:
        raise RuntimeError("password=hunter2")

    @api.get("/domain-invalid")
    def domain_invalid(request: HttpRequest) -> NoReturn:
        # Erreur métier d'un service : son message reprend la valeur saisie (donnée de santé).
        raise DjangoValidationError(
            {"height_m": [DjangoValidationError("Valeur 9.99 hors bornes", code="max_value")]}
        )

    return TestClient(api)


@pytest.fixture
def api_client() -> TestClient:
    return _build_client()


def test_not_found_is_a_problem_without_internal_message(api_client: TestClient) -> None:
    response = api_client.get("/missing")

    assert response.status_code == 404
    assert response["Content-Type"] == PROBLEM_CONTENT_TYPE
    assert response.json() == {
        "type": "about:blank",
        "title": "Not Found",
        "status": 404,
        "instance": "/missing",
    }


def test_http_error_keeps_status_and_detail(api_client: TestClient) -> None:
    response = api_client.get("/conflict")

    assert response.status_code == 409
    assert response.json()["title"] == "Conflict"
    assert response.json()["detail"] == "Cette séance est déjà terminée."


def test_validation_error_never_echoes_submitted_values(api_client: TestClient) -> None:
    response = api_client.post("/weights", json={"kg": "quatre-vingt-deux"})

    assert response.status_code == 422
    assert response["Content-Type"] == PROBLEM_CONTENT_TYPE
    body = response.json()
    assert body["errors"][0]["loc"] == ["body", "payload", "kg"]
    assert set(body["errors"][0]) == {"loc", "msg", "type"}
    assert "quatre-vingt-deux" not in response.content.decode()


def test_unhandled_error_is_a_generic_500(
    api_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    response = api_client.get("/boom")

    assert response.status_code == 500
    assert response.json()["title"] == "Internal Server Error"
    assert "hunter2" not in response.content.decode()
    assert "Unhandled API error" in caplog.text


def test_unknown_api_route_is_a_problem(client: Client) -> None:
    response = client.get("/api/v1/does-not-exist/")

    assert response.status_code == 404
    assert response["Content-Type"] == PROBLEM_CONTENT_TYPE


def test_unknown_non_api_route_keeps_html_404(client: Client) -> None:
    response = client.get("/does-not-exist/")

    assert response.status_code == 404
    assert response["Content-Type"].startswith("text/html")


def test_domain_validation_error_is_a_422_without_values_nor_logs(
    api_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    response = api_client.get("/domain-invalid")

    assert response.status_code == 422
    assert response["Content-Type"] == PROBLEM_CONTENT_TYPE
    assert response.json()["errors"] == [{"loc": ["height_m"], "type": "max_value"}]
    assert "9.99" not in response.content.decode()
    assert "9.99" not in caplog.text
