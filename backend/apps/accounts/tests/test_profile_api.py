"""`/api/v1/me/profile/` : chaque compte ne lit et ne modifie que son propre profil."""

from typing import Any

import pytest
from django.test import Client

from apps.accounts.models import Goal, UnitSystem
from apps.accounts.services import save_profile
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user

pytestmark = pytest.mark.django_db

PROFILE = "/api/v1/me/profile/"
VALID = {"height_m": 1.8, "goal": "gain", "unit_system": "metric"}


def put(client: Client, token: str, body: dict[str, Any]) -> Any:
    return client.put(PROFILE, body, content_type="application/json", headers=bearer(token))


def test_profile_is_absent_before_onboarding(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    response = client.get(PROFILE, headers=bearer(token))

    assert response.status_code == 404
    assert response["Content-Type"] == "application/problem+json"


def test_put_creates_then_updates_the_profile(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    created = put(client, token, VALID)
    updated = put(client, token, {**VALID, "height_m": 1.79, "goal": "maintain"})

    assert created.status_code == 200
    assert updated.status_code == 200
    body = client.get(PROFILE, headers=bearer(token)).json()
    assert body["height_m"] == 1.79
    assert body["goal"] == "maintain"
    assert body["unit_system"] == "metric"
    assert body["onboarded_at"] == created.json()["onboarded_at"]


@pytest.mark.parametrize(
    "change",
    [
        {"height_m": 0.5},
        {"height_m": 3},
        {"goal": "bulk"},
        {"unit_system": "si"},
        {"height_m": None},
        {"height_m": True},
        {"height_m": "1.8"},
    ],
)
def test_invalid_profiles_are_refused(client: Client, change: dict[str, Any]) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    response = put(client, token, {**VALID, **change})

    assert response.status_code == 422
    assert client.get(PROFILE, headers=bearer(token)).status_code == 404


def test_a_user_never_reads_or_overwrites_another_profile(client: Client) -> None:
    alice = make_verified_user(email="alice@example.com")
    bob = make_verified_user(email="bob@example.com")
    save_profile(user=alice, height_m=1.65, goal=Goal.CUT, unit_system=UnitSystem.IMPERIAL)
    bob_token = login(client, bob.email)["access_token"]

    assert client.get(PROFILE, headers=bearer(bob_token)).status_code == 404
    # Champs d'appartenance ajoutés au corps : ignorés, le propriétaire vient du JWT.
    written = put(client, bob_token, {**VALID, "user": str(alice.pk), "user_id": str(alice.pk)})
    assert written.status_code == 200
    assert client.get(PROFILE, headers=bearer(bob_token)).json()["goal"] == "gain"

    alice_token = login(Client(), alice.email)["access_token"]
    alice_profile = Client().get(PROFILE, headers=bearer(alice_token)).json()
    assert alice_profile["height_m"] == 1.65
    assert alice_profile["goal"] == "cut"


@pytest.mark.parametrize("method", ["get", "put"])
def test_profile_requires_authentication(client: Client, method: str) -> None:
    response = getattr(client, method)(PROFILE, VALID, content_type="application/json")

    assert response.status_code == 401
