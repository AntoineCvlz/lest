"""RGPD : export complet des données d'un compte, suppression immédiate et définitive."""

from __future__ import annotations

from smtplib import SMTPRecipientsRefused
from typing import Any
from unittest import mock

import pytest
from allauth.account.models import EmailAddress
from django.apps import apps
from django.contrib.admin.models import CHANGE, LogEntry
from django.core import mail
from django.db import models
from django.test import Client

from apps.accounts.gdpr import EXCLUDED_FROM_EXPORT, EXPORTED_MODELS
from apps.accounts.models import Goal, Profile, UnitSystem, User
from apps.accounts.selectors import export_account
from apps.accounts.services import IncorrectPasswordError, delete_account, save_profile
from apps.accounts.tests.auth import APP, bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_user, make_verified_user

pytestmark = pytest.mark.django_db

ME = "/api/v1/me/"
EXPORT = "/api/v1/me/export/"


def user_relations() -> list[models.Field[Any, Any]]:
    """Champs, dans tous les modèles, qui référencent un utilisateur (FK, un-à-un, M2M)."""
    return [
        field
        for model in apps.get_models()
        for field in model._meta.get_fields()
        if isinstance(field, models.ForeignKey | models.OneToOneField | models.ManyToManyField)
        and field.related_model is User
        and field.model is model
    ]


def related_to_user() -> set[str]:
    return {field.model._meta.label_lower for field in user_relations()}


def test_every_model_holding_user_data_is_exported_or_explicitly_excluded() -> None:
    # Garde-fou des futurs domaines : une table liée au compte doit rejoindre l'export, ou
    # être exclue avec une raison (et être supprimée avec le compte).
    assert related_to_user() == EXPORTED_MODELS | set(EXCLUDED_FROM_EXPORT)


def test_user_data_is_deleted_with_the_account() -> None:
    # Une FK en SET_NULL ou PROTECT laisserait des données (de santé) orphelines ou bloquerait
    # la suppression ; une M2M vers User doit être justifiée ici.
    not_cascading = {
        f"{field.model._meta.label_lower}.{field.name}"
        for field in user_relations()
        if isinstance(field, models.ManyToManyField)
        or getattr(field.remote_field, "on_delete", None) is not models.CASCADE
    }

    assert not_cascading == set()


def test_export_contains_the_account_its_addresses_and_its_profile() -> None:
    user = make_verified_user(email="membre@example.com")
    save_profile(user=user, height_m=1.8, goal=Goal.GAIN, unit_system=UnitSystem.METRIC)

    data = export_account(user)

    assert data["account"]["email"] == "membre@example.com"
    assert data["email_addresses"] == [
        {"email": "membre@example.com", "verified": True, "primary": True}
    ]
    assert data["profile"]["height_m"] == 1.8
    assert data["profile"]["goal"] == "gain"


def test_export_never_contains_secrets() -> None:
    user = make_verified_user()

    flat = repr(export_account(user))

    assert user.password not in flat
    assert "password" not in flat
    assert str(user.pk) not in flat  # identifiant interne : sans intérêt pour l'utilisateur


def test_export_endpoint_is_a_json_download_of_the_caller_only(client: Client) -> None:
    alice = make_verified_user(email="alice@example.com")
    make_verified_user(email="bob@example.com")
    token = login(client, alice.email)["access_token"]

    response = client.get(EXPORT, headers=bearer(token))

    assert response.status_code == 200
    assert response["Content-Disposition"].startswith('attachment; filename="lest-export-')
    assert response["Cache-Control"] == "no-store"
    body: dict[str, Any] = response.json()
    assert body["account"]["email"] == "alice@example.com"
    assert "bob@example.com" not in response.content.decode()


def test_delete_account_erases_everything_and_notifies_the_holder(
    django_capture_on_commit_callbacks: Any,
) -> None:
    user = make_verified_user(email="membre@example.com")
    save_profile(user=user, height_m=1.8, goal=Goal.GAIN, unit_system=UnitSystem.METRIC)
    LogEntry.objects.log_actions(  # action du personnel sur ce compte (e-mail dans le journal)
        user_id=make_user(is_staff=True).pk, queryset=[user], action_flag=CHANGE
    )

    with django_capture_on_commit_callbacks(execute=True):
        delete_account(user=user, password=TEST_PASSWORD)

    assert not User.objects.filter(email="membre@example.com").exists()
    assert not Profile.objects.exists()
    assert not EmailAddress.objects.filter(email="membre@example.com").exists()
    assert not LogEntry.objects.filter(object_repr="membre@example.com").exists()
    assert mail.outbox[-1].to == ["membre@example.com"]


def test_deletion_revokes_every_device_and_only_this_account() -> None:
    alice = make_verified_user(email="alice@example.com")
    bob = make_verified_user(email="bob@example.com")
    phone, laptop, bob_client = Client(), Client(), Client()
    devices = [login(phone, alice.email), login(laptop, alice.email)]
    bob_token = login(bob_client, bob.email)["access_token"]

    delete_account(user=alice, password=TEST_PASSWORD)

    for client, tokens in zip((phone, laptop), devices, strict=True):
        assert client.get(ME, headers=bearer(tokens["access_token"])).status_code == 401
        refreshed = client.post(
            f"{APP}/tokens/refresh",
            {"refresh_token": tokens["refresh_token"]},
            content_type="application/json",
        )
        assert refreshed.status_code in {400, 401}
    assert bob_client.get(ME, headers=bearer(bob_token)).status_code == 200


def test_deletion_cost_does_not_grow_with_other_sessions(
    django_assert_max_num_queries: Any,
) -> None:
    for _ in range(30):
        login(Client(), make_verified_user().email)
    user = make_verified_user()

    with django_assert_max_num_queries(20):
        delete_account(user=user, password=TEST_PASSWORD)


def test_a_mail_failure_does_not_fail_the_deletion_nor_log_the_address(
    client: Client, caplog: pytest.LogCaptureFixture, django_capture_on_commit_callbacks: Any
) -> None:
    user = make_verified_user(email="refuse@example.com")
    token = login(client, user.email)["access_token"]
    refused = SMTPRecipientsRefused({"refuse@example.com": (550, b"refus")})

    with (
        mock.patch("apps.accounts.services.send_mail", side_effect=refused),
        django_capture_on_commit_callbacks(execute=True),
    ):
        response = client.delete(
            ME,
            {"password": TEST_PASSWORD},
            content_type="application/json",
            headers=bearer(token),
        )

    assert response.status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()
    assert "refuse@example.com" not in caplog.text


def test_delete_account_requires_the_current_password() -> None:
    user = make_verified_user()

    with pytest.raises(IncorrectPasswordError):
        delete_account(user=user, password="pas-le-bon-mot-de-passe")

    assert User.objects.filter(pk=user.pk).exists()


def test_delete_endpoint_revokes_the_tokens(client: Client) -> None:
    user = make_verified_user()
    tokens = login(client, user.email)

    response = client.delete(
        ME,
        {"password": TEST_PASSWORD},
        content_type="application/json",
        headers=bearer(tokens["access_token"]),
    )

    assert response.status_code == 204
    assert client.get(ME, headers=bearer(tokens["access_token"])).status_code == 401
    refreshed = client.post(
        f"{APP}/tokens/refresh",
        {"refresh_token": tokens["refresh_token"]},
        content_type="application/json",
    )
    assert refreshed.status_code in {400, 401}


def test_delete_endpoint_refuses_a_wrong_password(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    response = client.delete(
        ME, {"password": "pas-le-bon"}, content_type="application/json", headers=bearer(token)
    )

    assert response.status_code == 403
    assert response["Content-Type"] == "application/problem+json"
    assert response.json()["type"] == "urn:lest:problem:incorrect-password"
    assert User.objects.filter(pk=user.pk).exists()


def wrong_delete(client: Client, token: str) -> int:
    response = client.delete(
        ME, {"password": "pas-le-bon"}, content_type="application/json", headers=bearer(token)
    )
    return response.status_code


def test_wrong_passwords_count_towards_the_login_lockout(client: Client) -> None:
    # Sinon `DELETE /me/` permettrait de tester des mots de passe hors du verrouillage du login.
    user = make_verified_user()
    token = login(client, user.email)["access_token"]

    statuses = [wrong_delete(client, token) for _ in range(6)]

    assert statuses == [403] * 5 + [429]
    blocked = Client().post(
        f"{APP}/auth/login",
        {"email": user.email, "password": TEST_PASSWORD},
        content_type="application/json",
    )
    assert blocked.json()["errors"][0]["code"] == "too_many_login_attempts"


def test_failed_logins_also_block_the_deletion(client: Client) -> None:
    user = make_verified_user()
    token = login(client, user.email)["access_token"]
    for _ in range(5):
        Client().post(
            f"{APP}/auth/login",
            {"email": user.email, "password": "pas-le-bon"},
            content_type="application/json",
        )

    response = client.delete(
        ME, {"password": TEST_PASSWORD}, content_type="application/json", headers=bearer(token)
    )

    assert response.status_code == 429
    assert User.objects.filter(pk=user.pk).exists()


def test_a_user_can_only_delete_their_own_account(client: Client) -> None:
    alice = make_verified_user(email="alice@example.com")
    bob = make_verified_user(email="bob@example.com")
    token = login(client, bob.email)["access_token"]

    client.delete(
        ME,
        {"password": TEST_PASSWORD, "user": str(alice.pk)},
        content_type="application/json",
        headers=bearer(token),
    )

    assert User.objects.filter(pk=alice.pk).exists()
    assert not User.objects.filter(pk=bob.pk).exists()
