"""Double authentification (allauth.mfa, headless) : TOTP, codes de secours, secrets chiffrés."""

from typing import Any

import pytest
from allauth.mfa.models import Authenticator
from allauth.mfa.totp.internal.auth import (
    format_hotp_value,
    hotp_value,
    yield_hotp_counters_from_time,
)
from django.core.cache import cache
from django.test import Client, override_settings

from apps.accounts.checks import check_mfa_bypass
from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from common import crypto

pytestmark = pytest.mark.django_db

TOTP = f"{APP}/account/authenticators/totp"
RECOVERY = f"{APP}/account/authenticators/recovery-codes"


def current_code(secret: str) -> str:
    code: str = format_hotp_value(hotp_value(secret, next(iter(yield_hotp_counters_from_time()))))
    return code


def enable_totp(client: Client, user: User) -> tuple[str, str]:
    """Active TOTP pour `user` ; renvoie le secret et le jeton d'accès."""
    token = login(client, user.email)["access_token"]
    # Action sensible : allauth exige une réauthentification récente (mot de passe).
    reauth = client.post(
        f"{APP}/auth/reauthenticate",
        {"password": TEST_PASSWORD},
        content_type="application/json",
        headers=bearer(token),
    )
    assert reauth.status_code == 200, reauth.content
    pending = client.get(TOTP, headers=bearer(token))
    assert pending.status_code == 404  # pas encore actif : allauth propose un secret
    secret: str = pending.json()["meta"]["secret"]
    activated = client.post(
        TOTP, {"code": current_code(secret)}, content_type="application/json", headers=bearer(token)
    )
    assert activated.status_code == 200, activated.content
    cache.clear()  # le code vient d'être consommé : simule la fenêtre de temps suivante
    return secret, token


def login_attempt(client: Client, email: str) -> Any:
    return client.post(
        f"{APP}/auth/login",
        {"email": email, "password": TEST_PASSWORD},
        content_type="application/json",
    )


def second_factor(client: Client, session_token: str, code: str) -> Any:
    return client.post(
        f"{APP}/auth/2fa/authenticate",
        {"code": code},
        content_type="application/json",
        headers={"X-Session-Token": session_token},
    )


def test_enabling_totp_requires_a_recent_reauthentication(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    secret = client.get(TOTP, headers=bearer(token)).json()["meta"]["secret"]

    # Code valide, mais pas de réauthentification : refus (le code faux est refusé avant, en 400).
    response = client.post(
        TOTP, {"code": current_code(secret)}, content_type="application/json", headers=bearer(token)
    )

    assert response.status_code == 401
    assert "reauthenticate" in {flow["id"] for flow in response.json()["data"]["flows"]}
    assert not Authenticator.objects.filter(user=user).exists()


def test_the_totp_secret_is_encrypted_at_rest(client: Client) -> None:
    user = make_verified_user()

    secret, _ = enable_totp(client, user)

    stored = Authenticator.objects.get(user=user, type=Authenticator.Type.TOTP).data["secret"]
    assert stored != secret
    assert secret not in stored
    assert crypto.decrypt(stored) == secret


def test_login_requires_the_second_factor_once_enabled(client: Client) -> None:
    user = make_verified_user()
    secret, _ = enable_totp(client, user)

    first_step = login_attempt(Client(), user.email)

    assert first_step.status_code == 401
    flows = {flow["id"] for flow in first_step.json()["data"]["flows"] if flow.get("is_pending")}
    assert flows == {"mfa_authenticate"}
    assert "access_token" not in first_step.json()["meta"]

    session_token = first_step.json()["meta"]["session_token"]
    assert second_factor(Client(), session_token, "000000").status_code == 400
    done = second_factor(Client(), session_token, current_code(secret))
    assert done.status_code == 200
    assert done.json()["meta"]["access_token"]


def test_a_recovery_code_works_once(client: Client) -> None:
    user = make_verified_user()
    _, token = enable_totp(client, user)
    codes: list[str] = client.get(RECOVERY, headers=bearer(token)).json()["data"]["unused_codes"]
    assert len(codes) == 10

    first = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    assert second_factor(Client(), first, codes[0]).status_code == 200
    again = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    assert second_factor(Client(), again, codes[0]).status_code == 400


def test_recovery_codes_are_encrypted_at_rest(client: Client) -> None:
    user = make_verified_user()
    _, token = enable_totp(client, user)
    codes: list[str] = client.get(RECOVERY, headers=bearer(token)).json()["data"]["unused_codes"]

    stored = repr(Authenticator.objects.get(user=user, type=Authenticator.Type.RECOVERY_CODES).data)

    assert not any(code in stored for code in codes)


def test_export_lists_authenticators_without_any_secret(client: Client) -> None:
    user = make_verified_user()
    secret, _ = enable_totp(client, user)

    data = export_account(user)

    assert {item["type"] for item in data["authenticators"]} == {"totp", "recovery_codes"}
    assert secret not in repr(data)
    assert "seed" not in repr(data)


@pytest.mark.parametrize(("debug", "errors"), [(False, 1), (True, 0)])
def test_a_totp_bypass_code_is_refused_outside_development(debug: bool, errors: int) -> None:
    with override_settings(DEBUG=debug, MFA_TOTP_INSECURE_BYPASS_CODE="123456"):
        assert len(check_mfa_bypass(None)) == errors


def test_no_bypass_code_is_configured() -> None:
    assert check_mfa_bypass(None) == []
