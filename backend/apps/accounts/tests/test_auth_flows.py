"""Parcours de compte via l'API headless d'allauth (client `app`, ADR 0001)."""

import re
from typing import Any

import pytest
from django.core import mail
from django.test import Client, override_settings

from apps.accounts.models import User
from apps.accounts.tests.factories import TEST_PASSWORD, make_user, make_verified_user

pytestmark = pytest.mark.django_db

AUTH = "/api/v1/auth/app/v1/auth"
STRONG_PASSWORD = "barre-olympique-82kg"  # gitleaks:allow — mot de passe de test, pas un secret


def post(client: Client, path: str, body: dict[str, Any], token: str | None = None) -> Any:
    headers = {"X-Session-Token": token} if token else {}
    return client.post(path, body, content_type="application/json", headers=headers)


def last_code() -> str:
    """Code à usage unique (« ABCD-EFGH ») contenu dans le dernier e-mail envoyé."""
    body = str(mail.outbox[-1].body)
    match = re.search(r"^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$", body, re.MULTILINE)
    assert match, body
    return match.group(1)


def login(client: Client, email: str, password: str = TEST_PASSWORD) -> Any:
    return post(client, f"{AUTH}/login", {"email": email, "password": password})


def test_signup_normalizes_email_and_requires_verification_by_code(client: Client) -> None:
    response = post(
        client, f"{AUTH}/signup", {"email": " Nouveau@Example.COM ", "password": STRONG_PASSWORD}
    )

    assert response.status_code == 401  # compte créé mais pas encore authentifié
    pending = {flow["id"] for flow in response.json()["data"]["flows"] if flow.get("is_pending")}
    assert pending == {"verify_email"}
    assert User.objects.get().email == "nouveau@example.com"
    assert mail.outbox[-1].to == ["nouveau@example.com"]

    token = response.json()["meta"]["session_token"]
    verified = post(client, f"{AUTH}/email/verify", {"key": last_code()}, token)

    assert verified.status_code == 200
    assert verified.json()["meta"]["is_authenticated"] is True


def test_signup_rejects_weak_passwords(client: Client) -> None:
    response = post(client, f"{AUTH}/signup", {"email": "a@example.com", "password": "court"})

    assert response.status_code == 400
    assert not User.objects.exists()


def test_signup_with_an_existing_email_creates_no_account_and_reveals_nothing(
    client: Client,
) -> None:
    make_user(email="existant@example.com")

    response = post(
        client, f"{AUTH}/signup", {"email": "EXISTANT@example.com", "password": STRONG_PASSWORD}
    )

    # Même réponse qu'une inscription nouvelle : pas d'énumération des comptes.
    assert response.status_code == 401
    assert User.objects.count() == 1


def test_login_is_case_insensitive_on_email(client: Client) -> None:
    make_verified_user(email="membre@example.com")

    response = login(client, "Membre@Example.com")

    assert response.status_code == 200
    assert response.json()["data"]["user"]["email"] == "membre@example.com"


def test_login_with_a_wrong_password_fails_without_detail(client: Client) -> None:
    make_verified_user(email="membre@example.com")

    response = login(client, "membre@example.com", password="faux-mot-de-passe")

    assert response.status_code == 400
    assert "faux-mot-de-passe" not in response.content.decode()


def test_password_reset_is_requested_and_completed_by_code(client: Client) -> None:
    user = make_verified_user(email="oubli@example.com")

    requested = post(client, f"{AUTH}/password/request", {"email": "oubli@example.com"})
    assert requested.status_code == 401  # flux « password_reset_by_code » en attente
    token = requested.json()["meta"]["session_token"]

    reset = post(
        client, f"{AUTH}/password/reset", {"key": last_code(), "password": STRONG_PASSWORD}, token
    )

    assert reset.status_code in {200, 401}
    user.refresh_from_db()
    assert user.check_password(STRONG_PASSWORD)


def test_logout_ends_the_session(client: Client) -> None:
    user = make_verified_user(email="membre@example.com")
    token = login(client, user.email).json()["meta"]["session_token"]

    logout = client.delete(f"{AUTH}/session", headers={"X-Session-Token": token})
    after = client.get(f"{AUTH}/session", headers={"X-Session-Token": token})

    assert logout.status_code == 401
    assert after.status_code in {401, 410}


@override_settings(ACCOUNT_RATE_LIMITS={"confirm_email": None})
def test_the_verification_code_can_be_resent_twice(client: Client) -> None:
    signup = post(client, f"{AUTH}/signup", {"email": "a@example.com", "password": STRONG_PASSWORD})
    token = signup.json()["meta"]["session_token"]

    statuses = [
        post(client, f"{AUTH}/email/verify/resend", {}, token).status_code for _ in range(3)
    ]

    assert statuses == [200, 200, 409]
    assert len(mail.outbox) == 3


def test_resending_right_after_the_first_email_is_rate_limited(client: Client) -> None:
    signup = post(client, f"{AUTH}/signup", {"email": "a@example.com", "password": STRONG_PASSWORD})
    token = signup.json()["meta"]["session_token"]

    assert post(client, f"{AUTH}/email/verify/resend", {}, token).status_code == 429
