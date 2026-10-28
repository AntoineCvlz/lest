"""Inscription : même travail de hachage que l'adresse soit libre ou déjà inscrite.

Avec `ACCOUNT_PREVENT_ENUMERATION`, allauth renvoie la même réponse dans les deux cas, mais
ne hache le mot de passe que pour une adresse nouvelle : la différence de temps (Argon2)
révélerait qu'une adresse a un compte. On compte les hachages plutôt que de mesurer le temps.
"""

from unittest import mock

import pytest
from django.contrib.auth.hashers import get_hasher
from django.test import Client

from apps.accounts.tests.auth import APP
from apps.accounts.tests.factories import make_verified_user

pytestmark = pytest.mark.django_db

STRONG = "barre-olympique-82kg"  # gitleaks:allow — mot de passe de test, pas un secret


def hashes_during_signup(client: Client, email: str) -> int:
    hasher = type(get_hasher())
    original = hasher.encode
    with mock.patch.object(hasher, "encode", autospec=True, side_effect=original) as encode:
        response = client.post(
            f"{APP}/auth/signup",
            {"email": email, "password": STRONG},
            content_type="application/json",
        )
    assert response.status_code == 401
    return encode.call_count


def test_signup_hashes_once_whether_or_not_the_address_is_taken(client: Client) -> None:
    make_verified_user(email="existant@example.com")

    assert hashes_during_signup(client, "nouveau@example.com") == 1
    assert hashes_during_signup(client, "existant@example.com") == 1
