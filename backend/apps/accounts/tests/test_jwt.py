"""Jetons JWT d'allauth (ADR 0001) : RS256, durées, rotation, révocation, falsification."""

import base64
import json
import time
from typing import Any

import jwt
import pytest
from django.test import Client, override_settings

from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user

pytestmark = pytest.mark.django_db

APP = "/api/v1/auth/app/v1"


def login(client: Client, email: str) -> dict[str, Any]:
    response = client.post(
        f"{APP}/auth/login",
        {"email": email, "password": TEST_PASSWORD},
        content_type="application/json",
    )
    assert response.status_code == 200, response.content
    meta: dict[str, Any] = response.json()["meta"]
    return meta


def session(client: Client, access_token: str) -> int:
    response = client.get(
        f"{APP}/auth/session", headers={"Authorization": f"Bearer {access_token}"}
    )
    return response.status_code


def refresh(client: Client, refresh_token: str) -> Any:
    return client.post(
        f"{APP}/tokens/refresh", {"refresh_token": refresh_token}, content_type="application/json"
    )


def b64url(data: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def test_login_returns_rs256_tokens_with_the_adr_lifetimes(client: Client) -> None:
    make_verified_user(email="membre@example.com")

    meta = login(client, "membre@example.com")

    header = jwt.get_unverified_header(meta["access_token"])
    claims = jwt.decode(meta["access_token"], options={"verify_signature": False})
    assert header["alg"] == "RS256"
    assert 290 <= claims["exp"] - time.time() <= 300  # 5 minutes
    refresh_claims = jwt.decode(meta["refresh_token"], options={"verify_signature": False})
    assert refresh_claims["exp"] - time.time() == pytest.approx(14 * 24 * 3600, abs=10)


def test_access_token_authenticates_the_session(client: Client) -> None:
    make_verified_user(email="membre@example.com")
    meta = login(client, "membre@example.com")

    assert session(client, meta["access_token"]) == 200


def test_refresh_rotates_and_the_previous_refresh_token_is_refused(client: Client) -> None:
    make_verified_user(email="membre@example.com")
    first = login(client, "membre@example.com")

    rotated = refresh(client, first["refresh_token"])
    assert rotated.status_code == 200
    new_refresh = rotated.json()["data"]["refresh_token"]
    assert new_refresh != first["refresh_token"]
    assert session(client, rotated.json()["data"]["access_token"]) == 200

    # Réutiliser l'ancien refresh (jeton volé rejoué) est refusé.
    assert refresh(client, first["refresh_token"]).status_code in {400, 401}


def test_logout_revokes_access_and_refresh_tokens(client: Client) -> None:
    make_verified_user(email="membre@example.com")
    meta = login(client, "membre@example.com")

    logout = client.delete(
        f"{APP}/auth/session", headers={"Authorization": f"Bearer {meta['access_token']}"}
    )

    assert logout.status_code == 401
    assert session(client, meta["access_token"]) == 401  # validation avec état
    assert refresh(client, meta["refresh_token"]).status_code in {400, 401}


@pytest.mark.parametrize("tamper", ["signature", "alg-none"])
def test_forged_access_tokens_are_refused(client: Client, tamper: str) -> None:
    make_verified_user(email="membre@example.com")
    token = login(client, "membre@example.com")["access_token"]
    claims = jwt.decode(token, options={"verify_signature": False})

    if tamper == "signature":
        head, payload, signature = token.split(".")
        forged = f"{head}.{payload}.{signature[::-1]}"
    else:
        # Jeton non signé (« alg: none ») construit à la main : PyJWT refuse de l'émettre.
        forged = f"{b64url({'alg': 'none', 'typ': 'JWT'})}.{b64url(claims)}."

    assert session(client, forged) == 401


def test_expired_access_token_is_refused(client: Client) -> None:
    make_verified_user(email="membre@example.com")
    with override_settings(HEADLESS_JWT_ACCESS_TOKEN_EXPIRES_IN=-10):
        token = login(client, "membre@example.com")["access_token"]

    assert session(client, token) == 401
