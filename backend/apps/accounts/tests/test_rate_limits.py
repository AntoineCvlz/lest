"""Limitation de débit d'allauth derrière le proxy Next.js, qui pose l'IP du navigateur."""

import pytest
from django.test import Client, override_settings

from apps.accounts.adapter import CLIENT_IP_HEADER
from apps.accounts.tests.auth import APP
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user

pytestmark = pytest.mark.django_db

LOW_IP_LIMIT = {"login_failed": "2/m/ip"}
BLOCKED = "too_many_login_attempts"
WRONG_PASSWORD = "mauvais-mot-de-passe"  # gitleaks:allow — mot de passe de test, pas un secret


def login_error(
    client: Client, email: str, headers: dict[str, str], password: str = WRONG_PASSWORD
) -> str:
    """Code d'erreur allauth d'une tentative de connexion (`ok` si elle réussit)."""
    response = client.post(
        f"{APP}/auth/login",
        {"email": email, "password": password},
        content_type="application/json",
        headers=headers,
    )
    if response.status_code == 200:
        return "ok"
    assert response.status_code == 400, response.content
    code: str = response.json()["errors"][0]["code"]
    return code


def from_ip(ip: str) -> dict[str, str]:
    return {CLIENT_IP_HEADER: ip}


@override_settings(ACCOUNT_RATE_LIMITS=LOW_IP_LIMIT)
def test_failed_logins_are_counted_per_client_ip_given_by_the_proxy(client: Client) -> None:
    codes = [login_error(client, f"u{i}@example.com", from_ip("203.0.113.1")) for i in range(3)]

    assert codes[2] == BLOCKED
    assert BLOCKED not in codes[:2]
    assert login_error(client, "autre@example.com", from_ip("203.0.113.2")) != BLOCKED


@override_settings(ACCOUNT_RATE_LIMITS=LOW_IP_LIMIT)
def test_x_forwarded_for_is_ignored(client: Client) -> None:
    # Le client contrôle X-Forwarded-For : en changer à chaque essai ne crée pas de compteur neuf.
    for i in range(2):
        login_error(client, f"u{i}@example.com", {"X-Forwarded-For": f"198.51.100.{i}"})

    assert login_error(client, "u9@example.com", {"X-Forwarded-For": "198.51.100.99"}) == BLOCKED


@override_settings(ACCOUNT_RATE_LIMITS=LOW_IP_LIMIT)
def test_an_invalid_proxy_header_falls_back_to_the_socket_address(client: Client) -> None:
    for i in range(2):
        login_error(client, f"u{i}@example.com", from_ip(f"pas-une-ip-{i}"))

    assert login_error(client, "u9@example.com", {}) == BLOCKED


def test_an_account_is_locked_after_five_failures_whatever_the_ip(client: Client) -> None:
    user = make_verified_user()
    for i in range(5):
        assert login_error(client, user.email, from_ip(f"203.0.113.{i}")) != BLOCKED

    assert login_error(client, user.email, from_ip("203.0.113.50"), TEST_PASSWORD) == BLOCKED
