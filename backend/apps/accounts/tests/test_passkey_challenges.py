"""Défis WebAuthn à usage unique et sessions anonymes de courte durée (revue de sécurité #51)."""

from datetime import timedelta
from typing import Any

import pytest
from allauth.headless import app_settings
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.mfa_views import PASSKEY_LOGIN_SESSION_SECONDS
from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.accounts.tests.test_mfa import (
    current_code,
    enable_totp,
    login_attempt,
    second_factor,
)
from apps.accounts.tests.test_passkeys import (
    PASSKEY_LOGIN,
    WEBAUTHN,
    enable_passkey,
    reauthenticate_with_passkey,
)
from apps.accounts.tests.webauthn import SoftAuthenticator

pytestmark = pytest.mark.django_db

PHISHING = "https://lest.example.evil"


def session_of(token: str) -> Any:
    return app_settings.TOKEN_STRATEGY.lookup_session(token)


def post_assertion(
    client: Client, url: str, key: SoftAuthenticator, options: Any, headers: dict[str, str]
) -> Any:
    """Assertion valide de `key` pour ces options."""
    return client.post(
        url, {"credential": key.get(options)}, content_type="application/json", headers=headers
    )


def test_a_passkey_login_options_session_is_short_lived() -> None:
    response = Client().get(PASSKEY_LOGIN)

    session = session_of(response.json()["meta"]["session_token"])
    assert session is not None
    assert 0 < session.get_expiry_age() <= PASSKEY_LOGIN_SESSION_SECONDS


def test_signing_in_with_a_passkey_restores_the_normal_session_lifetime() -> None:
    user = make_verified_user()
    key, _ = enable_passkey(Client(), user)
    Session.objects.all().delete()
    client = Client()
    options = client.get(PASSKEY_LOGIN).json()
    headers = {"X-Session-Token": options["meta"]["session_token"]}

    request_options = options["data"]["request_options"]
    response = post_assertion(client, PASSKEY_LOGIN, key, request_options, headers)

    assert response.status_code == 200, response.content
    sessions = [s for s in Session.objects.all() if s.get_decoded().get("_auth_user_id")]
    assert len(sessions) == 1
    assert sessions[0].expire_date > timezone.now() + timedelta(days=1)


def test_a_refused_login_assertion_burns_the_challenge() -> None:
    user = make_verified_user()
    key, _ = enable_passkey(Client(), user)
    client = Client()
    options = client.get(PASSKEY_LOGIN).json()
    request_options = options["data"]["request_options"]
    headers = {"X-Session-Token": options["meta"]["session_token"]}

    refused = client.post(
        PASSKEY_LOGIN,
        {"credential": key.get(request_options, PHISHING)},
        content_type="application/json",
        headers=headers,
    )
    replayed = post_assertion(client, PASSKEY_LOGIN, key, request_options, headers)

    assert refused.status_code == 400
    assert replayed.status_code == 400


def test_a_refused_second_factor_assertion_burns_the_challenge() -> None:
    user = make_verified_user()
    key, _ = enable_passkey(Client(), user)
    cache.clear()
    attempt = login_attempt(Client(), user.email)
    headers = {"X-Session-Token": attempt.json()["meta"]["session_token"]}
    url = f"{APP}/auth/webauthn/authenticate"
    client = Client()
    options = client.get(url, headers=headers).json()["data"]["request_options"]

    refused = client.post(
        url,
        {"credential": key.get(options, PHISHING)},
        content_type="application/json",
        headers=headers,
    )
    replayed = post_assertion(client, url, key, options, headers)

    assert refused.status_code == 400
    assert replayed.status_code == 400


def test_a_refused_reauthentication_burns_the_challenge() -> None:
    client = Client()
    key, token = enable_passkey(client, make_verified_user())
    url = f"{APP}/auth/webauthn/reauthenticate"
    options = client.get(url, headers=bearer(token)).json()["data"]["request_options"]

    refused = client.post(
        url,
        {"credential": key.get(options, PHISHING)},
        content_type="application/json",
        headers=bearer(token),
    )
    replayed = post_assertion(client, url, key, options, bearer(token))

    assert refused.status_code == 400
    assert replayed.status_code == 400


def test_a_fresh_challenge_still_works_after_a_refusal() -> None:
    user = make_verified_user()
    key, _ = enable_passkey(Client(), user)
    client = Client()
    first = client.get(PASSKEY_LOGIN).json()
    headers = {"X-Session-Token": first["meta"]["session_token"]}
    client.post(
        PASSKEY_LOGIN,
        {"credential": key.get(first["data"]["request_options"], PHISHING)},
        content_type="application/json",
        headers=headers,
    )

    second = client.get(PASSKEY_LOGIN, headers=headers).json()
    # Même session : allauth ne renvoie pas de nouveau jeton.
    assert "session_token" not in second.get("meta", {})
    response = post_assertion(
        client, PASSKEY_LOGIN, key, second["data"]["request_options"], headers
    )

    assert response.status_code == 200, response.content


def signed_in_sessions() -> list[Session]:
    return [s for s in Session.objects.all() if s.get_decoded().get("_auth_user_id")]


def test_a_cancelled_passkey_then_a_password_login_keeps_the_normal_lifetime() -> None:
    # Clic sur « Se connecter avec une passkey », annulation, puis e-mail et mot de passe : le
    # BFF renvoie le même jeton de parcours.
    user = make_verified_user()
    client = Client()
    token = client.get(PASSKEY_LOGIN).json()["meta"]["session_token"]

    login(client, user.email, **{"X-Session-Token": token})

    sessions = signed_in_sessions()
    assert len(sessions) == 1
    assert sessions[0].expire_date > timezone.now() + timedelta(days=1)


def test_a_cancelled_passkey_does_not_shorten_the_second_factor_step() -> None:
    user = make_verified_user()
    client = Client()
    totp_secret, _ = enable_totp(client, user)
    cache.clear()
    token = client.get(PASSKEY_LOGIN).json()["meta"]["session_token"]

    attempt = client.post(
        f"{APP}/auth/login",
        {"email": user.email, "password": TEST_PASSWORD},
        content_type="application/json",
        headers={"X-Session-Token": token},
    )
    assert attempt.status_code == 401
    pending = attempt.json().get("meta", {}).get("session_token", token)
    assert session_of(pending).get_expiry_age() > PASSKEY_LOGIN_SESSION_SECONDS

    response = second_factor(Client(), pending, current_code(totp_secret))
    assert response.status_code == 200, response.content
    assert signed_in_sessions()[-1].expire_date > timezone.now() + timedelta(days=1)


def test_passkey_options_never_shorten_a_pending_second_factor_flow() -> None:
    user = make_verified_user()
    enable_totp(Client(), user)
    cache.clear()
    token = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    before = session_of(token).get_expiry_age()

    Client().get(PASSKEY_LOGIN, headers={"X-Session-Token": token})

    assert session_of(token).get_expiry_age() == before


def test_a_post_needing_reconfirmation_burns_the_registration_challenge() -> None:
    client = Client()
    key, token = enable_passkey(client, make_verified_user())
    reauthenticate_with_passkey(client, token, key)
    options = client.get(f"{WEBAUTHN}?passwordless", headers=bearer(token))
    assert options.status_code == 200, options.content
    attestation = SoftAuthenticator().create(options.json()["data"]["creation_options"])

    def add() -> int:
        return client.post(
            WEBAUTHN,
            {"name": "Ordinateur", "credential": attestation},
            content_type="application/json",
            headers=bearer(token),
        ).status_code

    with override_settings(ACCOUNT_REAUTHENTICATION_TIMEOUT=0):
        assert add() == 401
    # Confirmation de nouveau valable : la même attestation ne passe plus. Son défi a été
    # consommé par la validation, avant le contrôle de confirmation.
    assert add() == 400
