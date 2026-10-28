"""Réinitialisation du mot de passe par code : pas d'énumération, notification, révocation."""

import re
from typing import Any

import pytest
from django.core import mail
from django.test import Client

from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import make_verified_user

pytestmark = pytest.mark.django_db

AUTH = f"{APP}/auth"
KNOWN = "connu@example.com"
UNKNOWN = "inconnu@example.com"
NEW_PASSWORD = "disque-de-fonte-25kg"  # gitleaks:allow — mot de passe de test, pas un secret


def request_reset(client: Client, email: str) -> tuple[int, dict[str, Any], str]:
    """Demande un code ; renvoie le statut, le corps sans jeton de parcours, et ce jeton."""
    response = client.post(
        f"{AUTH}/password/request", {"email": email}, content_type="application/json"
    )
    body: dict[str, Any] = response.json()
    token: str = body.get("meta", {}).pop("session_token", "")
    return response.status_code, body, token


def reset(client: Client, token: str, code: str, password: str = NEW_PASSWORD) -> int:
    response = client.post(
        f"{AUTH}/password/reset",
        {"key": code, "password": password},
        content_type="application/json",
        headers={"X-Session-Token": token},
    )
    return response.status_code


def last_code() -> str:
    match = re.search(r"^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$", str(mail.outbox[-1].body), re.M)
    assert match, mail.outbox[-1].body
    return match.group(1)


def test_requests_for_known_and_unknown_addresses_look_identical(client: Client) -> None:
    make_verified_user(email=KNOWN)

    known = request_reset(client, KNOWN)
    assert len(mail.outbox) == 1
    unknown = request_reset(Client(), UNKNOWN)

    assert known[:2] == unknown[:2]
    assert len(mail.outbox) == 2  # un e-mail dans les deux cas (code, ou « compte inconnu »)


def test_wrong_codes_end_both_flows_at_the_same_attempt() -> None:
    make_verified_user(email=KNOWN)
    sequences = []
    for email in (KNOWN, UNKNOWN):
        client = Client()
        _, _, token = request_reset(client, email)
        sequences.append([reset(client, token, "BCDF-GHJK") for _ in range(4)])

    assert sequences[0] == sequences[1]


@pytest.mark.parametrize("key", [None, "BCDF-GHJK"])
def test_looking_up_a_reset_code_is_refused_whatever_the_address(key: str | None) -> None:
    # Le GET d'allauth ne compte les essais que pour un compte existant : un oracle d'existence.
    make_verified_user(email=KNOWN)
    statuses = []
    for email in (KNOWN, UNKNOWN):
        client = Client()
        _, _, token = request_reset(client, email)
        headers = {"X-Session-Token": token}
        if key:
            headers["X-Password-Reset-Key"] = key
        statuses.append(
            [client.get(f"{AUTH}/password/reset", headers=headers).status_code for _ in range(4)]
        )

    assert statuses == [[405] * 4, [405] * 4]


def test_the_account_holder_is_notified_of_the_change(client: Client) -> None:
    make_verified_user(email=KNOWN)
    _, _, token = request_reset(client, KNOWN)
    code = last_code()
    sent = len(mail.outbox)

    assert reset(client, token, code) in {200, 401}

    assert len(mail.outbox) == sent + 1
    assert mail.outbox[-1].to == [KNOWN]
    assert NEW_PASSWORD not in str(mail.outbox[-1].body)


def test_a_reset_revokes_the_sessions_open_on_other_devices() -> None:
    make_verified_user(email=KNOWN)
    phone = Client()
    tokens = login(phone, KNOWN)

    browser = Client()
    _, _, token = request_reset(browser, KNOWN)
    assert reset(browser, token, last_code()) in {200, 401}

    assert phone.get("/api/v1/me/", headers=bearer(tokens["access_token"])).status_code == 401
    refreshed = phone.post(
        f"{APP}/tokens/refresh",
        {"refresh_token": tokens["refresh_token"]},
        content_type="application/json",
    )
    assert refreshed.status_code in {400, 401}


@pytest.mark.parametrize("email", [KNOWN, UNKNOWN])
def test_requests_are_limited_per_address(email: str) -> None:
    make_verified_user(email=KNOWN)

    statuses = [request_reset(Client(), email)[0] for _ in range(4)]

    assert statuses[:3] == [401, 401, 401]
    assert statuses[3] == 429
