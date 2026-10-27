"""`GET /api/v1/me/` : identité du compte connecté, et seulement la sienne."""

import jwt
import pytest
from django.test import Client

from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.accounts.tests.test_jwt import verified_claims
from common.keys import generate_rsa_private_key_pem

pytestmark = pytest.mark.django_db

ME = "/api/v1/me/"


def test_returns_only_the_identity_of_the_token_owner(client: Client) -> None:
    alice = make_verified_user(email="alice@example.com")
    bob = make_verified_user(email="bob@example.com")
    alice_token = login(client, alice.email)["access_token"]
    bob_token = login(client, bob.email)["access_token"]

    alice_me = client.get(ME, headers=bearer(alice_token))
    bob_me = client.get(ME, headers=bearer(bob_token))

    assert alice_me.status_code == 200
    assert alice_me.json() == {"id": str(alice.pk), "email": "alice@example.com"}
    assert bob_me.json() == {"id": str(bob.pk), "email": "bob@example.com"}


def test_the_session_cookie_alone_does_not_authenticate(client: Client) -> None:
    user = make_verified_user()
    client.force_login(user)

    response = client.get(ME)

    assert response.status_code == 401


@pytest.mark.parametrize(
    "authorization",
    ["", "Bearer", "Bearer pas-un-jwt", "Token abc", "Basic dXNlcjpwYXNz"],
)
def test_requests_without_a_valid_bearer_token_are_refused(
    client: Client, authorization: str
) -> None:
    response = client.get(ME, headers={"Authorization": authorization} if authorization else {})

    assert response.status_code == 401
    assert response["Content-Type"] == "application/problem+json"
    assert response.json()["status"] == 401


def test_token_is_refused_once_the_account_is_deactivated(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    user.is_active = False
    user.save(update_fields=["is_active"])

    assert client.get(ME, headers=bearer(token)).status_code == 401


def test_token_is_refused_after_logout(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    client.delete(f"{APP}/auth/session", headers=bearer(token))

    assert client.get(ME, headers=bearer(token)).status_code == 401


def test_token_is_refused_after_a_password_change(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    user.set_password("un-tout-autre-mot-de-passe")  # gitleaks:allow — mot de passe de test
    user.save(update_fields=["password"])

    assert client.get(ME, headers=bearer(token)).status_code == 401


def test_a_refresh_token_is_not_accepted_as_an_access_token(client: Client) -> None:
    user = make_verified_user()
    refresh_token = login(client, user.email)["refresh_token"]

    assert client.get(ME, headers=bearer(refresh_token)).status_code == 401


def test_a_token_signed_by_another_key_is_refused(client: Client) -> None:
    user = make_verified_user()
    claims = verified_claims(login(client, user.email)["access_token"])
    foreign_key = generate_rsa_private_key_pem()

    forged = jwt.encode(claims, foreign_key, algorithm="RS256")

    assert client.get(ME, headers=bearer(forged)).status_code == 401
