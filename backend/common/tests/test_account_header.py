"""En-tête `X-Lest-Account` : une saisie rejouée n'écrit jamais dans un autre compte (ADR 0015)."""

import uuid

import pytest
from django.test import Client

from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.body.models import BodyWeight

pytestmark = pytest.mark.django_db

ME = "/api/v1/me/"
WEIGHT = "/api/v1/body-weights/2026-11-01/"


def test_a_matching_account_is_accepted(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    response = client.get(ME, headers={**bearer(token), "X-Lest-Account": str(user.pk)})

    assert response.status_code == 200


def test_without_the_header_nothing_changes(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    assert client.get(ME, headers=bearer(token)).status_code == 200


@pytest.mark.parametrize("expected", [str(uuid.uuid4()), "", "pas-un-uuid"])
def test_another_account_is_refused_before_any_write(client: Client, expected: str) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    response = client.put(
        WEIGHT,
        {"weight_kg": "80.00"},
        content_type="application/json",
        headers={**bearer(token), "X-Lest-Account": expected},
    )

    assert response.status_code == 409
    assert response["Content-Type"] == "application/problem+json"
    assert response.json()["type"] == "urn:lest:problem:account-mismatch"
    assert not BodyWeight.objects.exists()


def test_the_header_does_not_authenticate(client: Client) -> None:
    user = make_verified_user()

    response = client.get(ME, headers={"X-Lest-Account": str(user.pk)})

    assert response.status_code == 401
