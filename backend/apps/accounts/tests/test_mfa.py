"""Double authentification (allauth.mfa, headless) : TOTP, codes de secours, secrets chiffrés."""

import re
from typing import Any

import pytest
from allauth.mfa.models import Authenticator
from allauth.mfa.totp.internal.auth import (
    format_hotp_value,
    hotp_value,
    yield_hotp_counters_from_time,
)
from django.conf import settings
from django.contrib.sessions.models import Session
from django.core import mail
from django.core.cache import cache
from django.core.checks import run_checks
from django.test import Client, override_settings

from apps.accounts.checks import check_mfa_bypass
from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from common import crypto

pytestmark = pytest.mark.django_db

TOTP = f"{APP}/account/authenticators/totp"
NEW_PASSWORD = "disque-de-fonte-25kg"  # gitleaks:allow — mot de passe de test, pas un secret
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


def test_a_totp_code_cannot_be_replayed(client: Client) -> None:
    user = make_verified_user()
    secret, _ = enable_totp(client, user)
    code = current_code(secret)

    first = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    assert second_factor(Client(), first, code).status_code == 200
    again = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    assert second_factor(Client(), again, code).status_code == 400


def test_disabling_totp_requires_reauthentication(client: Client) -> None:
    user = make_verified_user()
    _, token = enable_totp(client, user)

    # Délai de réauthentification écoulé : la désactivation exige à nouveau le mot de passe.
    with override_settings(ACCOUNT_REAUTHENTICATION_TIMEOUT=0):
        response = client.delete(TOTP, headers=bearer(token))

    assert response.status_code == 401
    assert "reauthenticate" in {flow["id"] for flow in response.json()["data"]["flows"]}
    assert Authenticator.objects.filter(user=user, type=Authenticator.Type.TOTP).exists()


def test_user_b_never_sees_user_a_authenticators(client: Client) -> None:
    alice = make_verified_user(email="alice@example.com")
    bob = make_verified_user(email="bob@example.com")
    alice_secret, _ = enable_totp(client, alice)

    bob_token = login(Client(), bob.email)["access_token"]
    listed = Client().get(f"{APP}/account/authenticators", headers=bearer(bob_token))
    pending = Client().get(TOTP, headers=bearer(bob_token))

    assert listed.json()["data"] == []
    assert pending.status_code == 404
    assert pending.json()["meta"]["secret"] != alice_secret


def test_the_bypass_check_runs_with_deployment_checks() -> None:
    with override_settings(DEBUG=False, MFA_TOTP_INSECURE_BYPASS_CODE="123456"):
        ids = {message.id for message in run_checks(include_deployment_checks=True)}

    assert "accounts.E001" in ids


def test_failed_logins_have_a_daily_cap_per_account() -> None:
    # Plafond journalier par compte (mot de passe ou second facteur) : sans lui, ~1 440 codes
    # par jour pourraient être essayés à 5 essais par tranche de 5 minutes.
    assert settings.ACCOUNT_RATE_LIMITS["login_failed_daily"] == "30/86400s/key"


@override_settings(
    ACCOUNT_RATE_LIMITS={**settings.ACCOUNT_RATE_LIMITS, "login_failed_daily": "3/86400s/key"}
)
def test_the_second_factor_is_locked_after_the_daily_cap(client: Client) -> None:
    user = make_verified_user()
    enable_totp(client, user)
    for _ in range(2):
        session_token = login_attempt(Client(), user.email).json()["meta"]["session_token"]
        second_factor(Client(), session_token, "000000")

    session_token = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    second_factor(Client(), session_token, "000000")  # 3e échec : plafond atteint

    # La connexion en attente est annulée, et le mot de passe (même juste) est refusé.
    assert second_factor(Client(), session_token, "000000").status_code in {401, 409}
    blocked = login_attempt(Client(), user.email)
    assert blocked.status_code == 400
    assert blocked.json()["errors"][0]["code"] == "too_many_login_attempts"


@override_settings(
    ACCOUNT_RATE_LIMITS={**settings.ACCOUNT_RATE_LIMITS, "login_failed_daily": "3/86400s/key"}
)
def test_wrong_passwords_do_not_lock_the_account_for_the_day() -> None:
    # Sinon n'importe qui, avec la seule adresse, bloquerait le compte 24 h.
    user = make_verified_user()
    for ip in ("203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"):
        Client().post(
            f"{APP}/auth/login",
            {"email": user.email, "password": "pas-le-bon"},
            content_type="application/json",
            headers={"X-Lest-Client-IP": ip},
        )
    cache.clear()  # fenêtre de 5 minutes d'allauth écoulée

    assert login_attempt(Client(), user.email).status_code == 200


@override_settings(
    ACCOUNT_RATE_LIMITS={**settings.ACCOUNT_RATE_LIMITS, "login_failed_daily": "1/86400s/key"}
)
def test_a_password_reset_does_not_lift_the_second_factor_cap(client: Client) -> None:
    # Sinon qui a le mot de passe et la boîte mail regagnerait des essais à chaque reset.
    user = make_verified_user()
    enable_totp(client, user)
    session_token = login_attempt(Client(), user.email).json()["meta"]["session_token"]
    second_factor(Client(), session_token, "000000")

    reset_client = Client()
    requested = reset_client.post(
        f"{APP}/auth/password/request", {"email": user.email}, content_type="application/json"
    )
    code = re.search(r"^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$", str(mail.outbox[-1].body), re.M)
    assert code
    reset_client.post(
        f"{APP}/auth/password/reset",
        {"key": code.group(1), "password": NEW_PASSWORD},
        content_type="application/json",
        headers={"X-Session-Token": requested.json()["meta"]["session_token"]},
    )

    relogin = Client().post(
        f"{APP}/auth/login",
        {"email": user.email, "password": NEW_PASSWORD},
        content_type="application/json",
    )
    assert relogin.json()["errors"][0]["code"] == "too_many_login_attempts"


@override_settings(
    ACCOUNT_RATE_LIMITS={**settings.ACCOUNT_RATE_LIMITS, "login_failed_ip_daily": "3/86400s/key"}
)
def test_wrong_passwords_are_capped_per_ip_without_locking_others_out() -> None:
    user = make_verified_user()

    def attempt(ip: str, password: str) -> Any:
        return Client().post(
            f"{APP}/auth/login",
            {"email": user.email, "password": password},
            content_type="application/json",
            headers={"X-Lest-Client-IP": ip},
        )

    # 3 échecs : sous la limite d'allauth (5 par 5 min), au plafond du jour pour cette IP.
    for _ in range(3):
        attempt("203.0.113.7", "pas-le-bon")

    assert attempt("203.0.113.7", TEST_PASSWORD).json()["errors"][0]["code"] == (
        "too_many_login_attempts"
    )
    assert attempt("198.51.100.4", TEST_PASSWORD).status_code == 200


def test_a_wrong_second_factor_notifies_the_holder_once_an_hour(client: Client) -> None:
    user = make_verified_user(email="titulaire@example.com")
    enable_totp(client, user)
    sent = len(mail.outbox)

    for _ in range(2):
        session_token = login_attempt(Client(), user.email).json()["meta"]["session_token"]
        second_factor(Client(), session_token, "000000")

    alerts = mail.outbox[sent:]
    assert [message.to for message in alerts] == [["titulaire@example.com"]]


def test_the_pending_totp_secret_leaves_the_session_after_activation(client: Client) -> None:
    user = make_verified_user()
    enable_totp(client, user)

    assert not any("mfa.totp.secret" in session.get_decoded() for session in Session.objects.all())
