"""Aides des tests d'API authentifiée : connexion allauth et en-tête `Authorization`."""

from typing import Any

from django.test import Client

from apps.accounts.tests.factories import TEST_PASSWORD

APP = "/api/v1/auth/app/v1"


def login(client: Client, email: str, **headers: str) -> dict[str, Any]:
    """Connecte `email` (mot de passe `TEST_PASSWORD`) et renvoie les jetons de `meta`."""
    response = client.post(
        f"{APP}/auth/login",
        {"email": email, "password": TEST_PASSWORD},
        content_type="application/json",
        headers=headers,
    )
    assert response.status_code == 200, response.content
    meta: dict[str, Any] = response.json()["meta"]
    return meta


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
