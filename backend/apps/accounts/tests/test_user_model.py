import uuid

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def test_project_uses_the_custom_user_model() -> None:
    assert settings.AUTH_USER_MODEL == "accounts.User"
    assert get_user_model() is User


def test_create_user_identifies_by_normalized_email_and_hashes_the_password() -> None:
    user = User.objects.create_user(email="  Antoine@Example.COM ", password="une-phrase-solide")

    assert user.email == "antoine@example.com"
    assert user.get_username() == "antoine@example.com"
    assert user.password != "une-phrase-solide"
    assert user.check_password("une-phrase-solide")
    assert user.is_active
    assert not user.is_staff
    assert not user.is_superuser


def test_primary_key_is_a_non_sequential_uuid() -> None:
    first = User.objects.create_user(email="a@example.com", password="x" * 12)
    second = User.objects.create_user(email="b@example.com", password="x" * 12)

    assert isinstance(first.pk, uuid.UUID)
    assert first.pk != second.pk


def test_user_without_password_cannot_log_in_with_one() -> None:
    user = User.objects.create_user(email="sans-mot-de-passe@example.com")

    assert not user.has_usable_password()


def test_email_is_required() -> None:
    with pytest.raises(ValueError, match="e-mail"):
        User.objects.create_user(email="   ", password="x" * 12)


def test_email_is_unique_regardless_of_case() -> None:
    User.objects.create_user(email="antoine@example.com", password="x" * 12)

    # Contrainte en base : même en contournant la normalisation du manager.
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create(email="ANTOINE@example.com")


def test_create_superuser_grants_staff_and_superuser() -> None:
    admin = User.objects.create_superuser(email="admin@example.com", password="x" * 12)

    assert admin.is_staff
    assert admin.is_superuser


def test_create_superuser_refuses_inconsistent_flags() -> None:
    with pytest.raises(ValueError, match="is_staff"):
        User.objects.create_superuser(email="admin@example.com", password="x" * 12, is_staff=False)


def test_string_representation_is_the_email() -> None:
    assert str(User(email="antoine@example.com")) == "antoine@example.com"
