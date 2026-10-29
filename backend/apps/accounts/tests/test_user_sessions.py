"""Sessions par appareil (allauth.usersessions) : liste, fermeture, isolation, export."""

from datetime import timedelta
from typing import Any

import pytest
from allauth.usersessions.models import UserSession
from django.contrib import admin
from django.contrib.sessions.models import Session
from django.test import Client
from django.utils import timezone

from apps.accounts.selectors import export_account
from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.accounts.tests.test_mfa import enable_totp
from apps.accounts.tests.test_passkeys import enable_passkey
from common.tasks import clear_expired_sessions

pytestmark = pytest.mark.django_db

SESSIONS = f"{APP}/auth/sessions"
ME = "/api/v1/me/"
PHONE = {"X-Lest-Client-IP": "203.0.113.7", "User-Agent": "Téléphone de test"}


def sessions_of(token: str) -> list[dict[str, Any]]:
    response = Client().get(SESSIONS, headers=bearer(token))
    assert response.status_code == 200, response.content
    data: list[dict[str, Any]] = response.json()["data"]
    return data


def still_signed_in(token: str) -> bool:
    return Client().get(ME, headers=bearer(token)).status_code == 200


def can_refresh(refresh_token: str) -> bool:
    response = Client().post(
        f"{APP}/tokens/refresh", {"refresh_token": refresh_token}, content_type="application/json"
    )
    return response.status_code == 200


def test_each_sign_in_is_listed_with_its_device() -> None:
    user = make_verified_user()
    login(Client(), user.email)
    token = login(Client(), user.email, **PHONE)["access_token"]

    sessions = sessions_of(token)

    assert len(sessions) == 2
    current = next(session for session in sessions if session["is_current"])
    assert current["ip"] == "203.0.113.7"
    assert current["user_agent"] == "Téléphone de test"


def test_enabling_the_app_signs_out_the_other_devices() -> None:
    user = make_verified_user()
    tokens = login(Client(), user.email)
    elsewhere = tokens["access_token"]

    _, here = enable_totp(Client(), user)

    assert not still_signed_in(elsewhere)
    assert not can_refresh(tokens["refresh_token"])
    assert still_signed_in(here)
    assert [session["is_current"] for session in sessions_of(here)] == [True]


def test_adding_a_passkey_signs_out_the_other_devices() -> None:
    user = make_verified_user()
    elsewhere = login(Client(), user.email)["access_token"]

    _, here = enable_passkey(Client(), user)

    assert not still_signed_in(elsewhere)
    assert still_signed_in(here)


def test_a_device_can_be_signed_out_remotely() -> None:
    user = make_verified_user()
    tokens = login(Client(), user.email)
    elsewhere = tokens["access_token"]
    here = login(Client(), user.email)["access_token"]
    other = next(session for session in sessions_of(here) if not session["is_current"])

    response = Client().delete(
        SESSIONS, {"sessions": [other["id"]]}, content_type="application/json", headers=bearer(here)
    )

    assert response.status_code == 200, response.content
    assert not still_signed_in(elsewhere)
    assert not can_refresh(tokens["refresh_token"])
    assert still_signed_in(here)


def test_user_b_cannot_see_or_end_user_a_sessions() -> None:
    alice, bob = make_verified_user(), make_verified_user()
    alice_token = login(Client(), alice.email)["access_token"]
    bob_token = login(Client(), bob.email)["access_token"]
    alice_session = sessions_of(alice_token)[0]

    response = Client().delete(
        SESSIONS,
        {"sessions": [alice_session["id"]]},
        content_type="application/json",
        headers=bearer(bob_token),
    )

    assert response.status_code == 400
    assert still_signed_in(alice_token)
    assert all(session["id"] != alice_session["id"] for session in sessions_of(bob_token))


def test_the_export_lists_devices_without_session_keys() -> None:
    user = make_verified_user()
    login(Client(), user.email, **PHONE)
    key = UserSession.objects.get(user=user).session_key

    exported = export_account(user)

    assert exported["sessions"] == [
        {
            "ip": "203.0.113.7",
            "user_agent": "Téléphone de test",
            "created_at": exported["sessions"][0]["created_at"],
            "last_seen_at": exported["sessions"][0]["last_seen_at"],
        }
    ]
    assert key not in str(exported)


def test_the_export_skips_devices_whose_session_is_gone() -> None:
    user = make_verified_user()
    login(Client(), user.email)
    login(Client(), user.email, **PHONE)
    gone = UserSession.objects.exclude(ip="203.0.113.7").get(user=user)
    Session.objects.filter(session_key=gone.session_key).delete()

    assert [session["ip"] for session in export_account(user)["sessions"]] == ["203.0.113.7"]


def test_the_nightly_cleanup_forgets_devices_of_expired_sessions() -> None:
    user = make_verified_user()
    login(Client(), user.email)
    login(Client(), user.email, **PHONE)
    expired = UserSession.objects.exclude(ip="203.0.113.7").get(user=user)
    Session.objects.filter(session_key=expired.session_key).update(
        expire_date=timezone.now() - timedelta(seconds=1)
    )

    clear_expired_sessions.delay().get(timeout=1)

    assert list(UserSession.objects.values_list("ip", flat=True)) == ["203.0.113.7"]


def test_device_sessions_have_no_admin_page() -> None:
    assert not admin.site.is_registered(UserSession)
