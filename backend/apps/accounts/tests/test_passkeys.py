from typing import Any

import pytest
from allauth.mfa.models import Authenticator
from django.conf import settings
from django.core.cache import cache
from django.test import Client, override_settings

from apps.accounts.checks import check_frontend_url, check_webauthn_origin
from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.accounts.tests.test_mfa import (
    RECOVERY,
    TOTP,
    current_code,
    enable_totp,
    login_attempt,
    reauthenticate_with_password,
)
from apps.accounts.tests.webauthn import SoftAuthenticator

pytestmark = pytest.mark.django_db

WEBAUTHN = f"{APP}/account/authenticators/webauthn"
PASSKEY_LOGIN = f"{APP}/auth/webauthn/login"


def add_passkey(client: Client, token: str, key: SoftAuthenticator) -> Any:
    options = client.get(f"{WEBAUTHN}?passwordless", headers=bearer(token))
    assert options.status_code == 200, options.content
    credential = key.create(options.json()["data"]["creation_options"])
    return client.post(
        WEBAUTHN,
        {"name": "Téléphone", "credential": credential},
        content_type="application/json",
        headers=bearer(token),
    )


def enable_passkey(
    client: Client, user: User, key: SoftAuthenticator | None = None
) -> tuple[SoftAuthenticator, str]:
    """Ajoute une passkey à un compte sans facteur (confirmation par mot de passe)."""
    token = login(client, user.email)["access_token"]
    reauthenticate_with_password(client, token)
    key = key or SoftAuthenticator()
    added = add_passkey(client, token, key)
    assert added.status_code == 200, added.content
    return key, token


def passkey_login(key: SoftAuthenticator, origin: str | None = None) -> Any:
    client = Client()
    options = client.get(PASSKEY_LOGIN)
    assert options.status_code == 200, options.content
    session_token = options.json()["meta"]["session_token"]
    return client.post(
        PASSKEY_LOGIN,
        {"credential": key.get(options.json()["data"]["request_options"], origin)},
        content_type="application/json",
        headers={"X-Session-Token": session_token},
    )


def reauthenticate_with_passkey(client: Client, token: str, key: SoftAuthenticator) -> None:
    url = f"{APP}/auth/webauthn/reauthenticate"
    options = client.get(url, headers=bearer(token)).json()["data"]["request_options"]
    response = client.post(
        url,
        {"credential": key.get(options)},
        content_type="application/json",
        headers=bearer(token),
    )
    assert response.status_code == 200, response.content


@override_settings(ALLOWED_HOSTS=["testserver", "api"])
def test_passkeys_are_bound_to_the_public_domain_not_the_internal_host(client: Client) -> None:
    # Derrière le proxy, Django reçoit l'hôte interne : le RP ID doit rester le domaine public.
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    reauthenticate_with_password(client, token)

    options = client.get(f"{WEBAUTHN}?passwordless", headers=bearer(token), HTTP_HOST="api:8000")

    assert options.json()["data"]["creation_options"]["publicKey"]["rp"] == {
        "id": "localhost",
        "name": "Lest",
    }


def test_a_passkey_signs_in_without_a_password(client: Client) -> None:
    user = make_verified_user()
    key, _ = enable_passkey(client, user)

    response = passkey_login(key)

    assert response.status_code == 200, response.content
    assert response.json()["meta"]["is_authenticated"] is True
    assert response.json()["meta"]["access_token"]


def test_a_passkey_login_requires_user_verification(client: Client) -> None:
    # Sans PIN ni biométrie, la seule possession de la clé ne connecte pas.
    user = make_verified_user()
    key, _ = enable_passkey(client, user)
    key.verifies_user = False

    response = passkey_login(key)

    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "incorrect_code"


def test_a_second_factor_key_cannot_sign_in_without_a_password(client: Client) -> None:
    user = make_verified_user()
    key, _ = enable_passkey(client, user, SoftAuthenticator(resident=False))

    assert passkey_login(key).status_code == 400


def test_another_session_cannot_ride_on_a_factor_added_meanwhile() -> None:
    # Session A confirmée par mot de passe ; le titulaire active l'application dans la session B :
    # A ne doit pas pour autant lire les codes de secours.
    user = make_verified_user()
    session_a = Client()
    token_a = login(session_a, user.email)["access_token"]
    reauthenticate_with_password(session_a, token_a)
    enable_totp(Client(), user)

    assert session_a.get(RECOVERY, headers=bearer(token_a)).status_code == 401


def test_adding_a_passkey_generates_recovery_codes(client: Client) -> None:
    user = make_verified_user()
    enable_passkey(client, user)

    assert Authenticator.objects.filter(user=user, type=Authenticator.Type.RECOVERY_CODES).exists()


def test_a_passkey_is_refused_from_another_origin(client: Client) -> None:
    # Hameçonnage : la même passkey présentée par un autre site ne connecte pas.
    user = make_verified_user()
    key, _ = enable_passkey(client, user)

    response = passkey_login(key, origin="https://lest-connexion.example")

    assert response.status_code == 400
    assert "access_token" not in response.json().get("meta", {})


def test_a_passkey_cannot_sign_in_as_another_user(client: Client) -> None:
    alice, bob = make_verified_user(), make_verified_user()
    alice_key, _ = enable_passkey(Client(), alice)
    bob_key, _ = enable_passkey(Client(), bob)
    # La clé de Bob, présentée avec l'identifiant utilisateur d'Alice.
    bob_key.user_handle = alice_key.user_handle

    response = passkey_login(bob_key)

    assert response.status_code == 400


def test_password_alone_cannot_add_a_passkey_to_a_protected_account(client: Client) -> None:
    # Session ouverte et mot de passe vu par-dessus l'épaule : pas de passkey de l'attaquant.
    user = make_verified_user()
    _, token = enable_totp(client, user)
    reauthenticate_with_password(client, token)

    options = client.get(f"{WEBAUTHN}?passwordless", headers=bearer(token))

    assert options.status_code == 401
    assert "mfa_reauthenticate" in {flow["id"] for flow in options.json()["data"]["flows"]}
    assert not Authenticator.objects.filter(user=user, type=Authenticator.Type.WEBAUTHN).exists()


def test_password_alone_cannot_add_an_app_to_an_account_with_a_passkey(client: Client) -> None:
    user = make_verified_user()
    _, token = enable_passkey(client, user)
    reauthenticate_with_password(client, token)

    assert client.get(TOTP, headers=bearer(token)).status_code == 401


def test_removing_a_passkey_requires_a_second_factor(client: Client) -> None:
    user = make_verified_user()
    key, token = enable_passkey(client, user)
    passkey = Authenticator.objects.get(user=user, type=Authenticator.Type.WEBAUTHN)
    reauthenticate_with_password(client, token)

    def remove() -> Any:
        return client.delete(
            WEBAUTHN,
            {"authenticators": [passkey.pk]},
            content_type="application/json",
            headers=bearer(token),
        )

    assert remove().status_code == 401
    reauthenticate_with_passkey(client, token, key)
    assert remove().status_code == 200
    assert not Authenticator.objects.filter(pk=passkey.pk).exists()


def test_a_passkey_confirmation_allows_adding_an_app(client: Client) -> None:
    user = make_verified_user()
    key, token = enable_passkey(client, user)
    reauthenticate_with_passkey(client, token, key)

    pending = client.get(TOTP, headers=bearer(token))
    activated = client.post(
        TOTP,
        {"code": current_code(pending.json()["meta"]["secret"])},
        content_type="application/json",
        headers=bearer(token),
    )

    assert activated.status_code == 200, activated.content


def test_a_password_login_asks_for_the_passkey_as_second_factor() -> None:
    user = make_verified_user()
    key, _ = enable_passkey(Client(), user)
    cache.clear()

    attempt = login_attempt(Client(), user.email)
    assert attempt.status_code == 401
    session_token = attempt.json()["meta"]["session_token"]
    url = f"{APP}/auth/webauthn/authenticate"
    headers = {"X-Session-Token": session_token}
    client = Client()
    options = client.get(url, headers=headers).json()["data"]["request_options"]
    response = client.post(
        url, {"credential": key.get(options)}, content_type="application/json", headers=headers
    )

    assert response.status_code == 200, response.content
    assert response.json()["meta"]["access_token"]


def test_user_b_never_sees_user_a_passkeys(client: Client) -> None:
    alice, bob = make_verified_user(), make_verified_user()
    enable_passkey(Client(), alice)
    bob_token = login(client, bob.email)["access_token"]

    listed = client.get(f"{APP}/account/authenticators", headers=bearer(bob_token))

    assert listed.json()["data"] == []


@pytest.mark.parametrize(("insecure", "errors"), [(True, 1), (False, 0)])
def test_insecure_webauthn_origins_are_refused(insecure: bool, errors: int) -> None:
    with override_settings(MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN=insecure):
        assert len(check_webauthn_origin(None)) == errors


def test_the_password_still_works_for_login_without_any_factor() -> None:
    # Sans facteur, le mot de passe seul connecte toujours (passkeys optionnelles).
    user = make_verified_user()

    response = Client().post(
        f"{APP}/auth/login",
        {"email": user.email, "password": TEST_PASSWORD},
        content_type="application/json",
    )

    assert response.status_code == 200


def test_allauth_uses_the_exact_origin_server() -> None:
    # Garde-fou : une mise à jour d'allauth ne doit pas défaire le remplacement en silence.
    from allauth.mfa.webauthn.internal import auth as webauthn_auth

    from apps.accounts.webauthn import get_server

    assert webauthn_auth.get_server is get_server


@pytest.mark.parametrize("origin", ["https://evil.localhost", "http://localhost:6006"])
def test_a_passkey_is_refused_from_a_sibling_origin(client: Client, origin: str) -> None:
    # Sous-domaine ou autre port : accepté par fido2 seul, refusé par l'origine exacte.
    user = make_verified_user()
    key, _ = enable_passkey(client, user)

    assert passkey_login(key, origin=origin).status_code == 400


def test_a_passkey_cannot_be_registered_from_another_origin(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    reauthenticate_with_password(client, token)

    added = add_passkey(client, token, SoftAuthenticator(origin="http://localhost:6006"))

    assert added.status_code == 400
    assert not Authenticator.objects.filter(user=user, type=Authenticator.Type.WEBAUTHN).exists()


def test_a_passkey_without_credprops_still_signs_in(client: Client) -> None:
    # Navigateur qui ne renvoie pas `credProps` : la passkey reste utilisable (UV signé exigé).
    user = make_verified_user()
    key = SoftAuthenticator(resident=None)  # extension `credProps` absente
    enable_passkey(client, user, key)

    assert passkey_login(key).status_code == 200


@override_settings(
    ACCOUNT_RATE_LIMITS={**settings.ACCOUNT_RATE_LIMITS, "passkey_login_options": "2/m/ip"}
)
def test_passkey_login_options_are_rate_limited() -> None:
    def options() -> int:
        return Client().get(PASSKEY_LOGIN, headers={"X-Lest-Client-IP": "203.0.113.9"}).status_code

    assert [options(), options(), options()] == [200, 200, 429]


def test_renaming_a_passkey_requires_a_second_factor(client: Client) -> None:
    user = make_verified_user()
    _, token = enable_passkey(client, user)
    passkey = Authenticator.objects.get(user=user, type=Authenticator.Type.WEBAUTHN)
    reauthenticate_with_password(client, token)

    response = client.put(
        WEBAUTHN,
        {"id": passkey.pk, "name": "Ancienne clé, à supprimer"},
        content_type="application/json",
        headers=bearer(token),
    )

    assert response.status_code == 401
    passkey.refresh_from_db()
    assert passkey.wrap().name == "Téléphone"


def test_the_export_names_passkeys_without_their_keys(client: Client) -> None:
    user = make_verified_user()
    enable_passkey(client, user)

    exported = export_account(user)

    passkeys = [a for a in exported["authenticators"] if a["type"] == "webauthn"]
    assert passkeys == [{**passkeys[0], "name": "Téléphone"}]
    assert "credential" not in str(exported)
    assert "authenticatorData" not in str(exported)


@pytest.mark.parametrize(
    ("url", "errors"),
    [
        ("http://localhost:3000", 1),
        ("http://lest.example", 1),
        ("https://10.0.0.1", 1),
        ("https://lest.example/app", 1),
        ("https://lest.example", 0),
    ],
)
def test_the_frontend_url_must_be_a_public_https_origin(url: str, errors: int) -> None:
    with override_settings(FRONTEND_URL=url):
        assert len(check_frontend_url(None)) == errors
