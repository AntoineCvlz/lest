import pytest
from allauth.account.models import EmailAddress
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django.test import Client

from apps.accounts.models import User
from apps.accounts.services import create_verified_user
from apps.accounts.tests.auth import APP

pytestmark = pytest.mark.django_db

STRONG = "Salle-de-fonte-2026"  # gitleaks:allow — mot de passe de test, pas un secret


def test_creates_an_active_account_whose_email_is_verified(client: Client) -> None:
    user = create_verified_user(email=" Membre@Example.com ", password=STRONG)

    assert user.email == "membre@example.com"
    address = EmailAddress.objects.get(user=user)
    assert (address.email, address.verified, address.primary) == (user.email, True, True)
    response = client.post(
        f"{APP}/auth/login",
        {"email": user.email, "password": STRONG},
        content_type="application/json",
    )
    assert response.status_code == 200


def test_refuses_a_weak_password_and_creates_nothing() -> None:
    with pytest.raises(ValidationError):
        create_verified_user(email="membre@example.com", password="1234")

    assert not User.objects.exists()


def test_command_reads_the_password_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LEST_USER_PASSWORD", STRONG)

    call_command("create_verified_user", "--email", "e2e@example.com")

    assert EmailAddress.objects.filter(email="e2e@example.com", verified=True).exists()


def test_command_requires_the_password_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LEST_USER_PASSWORD", raising=False)

    with pytest.raises(CommandError, match="LEST_USER_PASSWORD"):
        call_command("create_verified_user", "--email", "e2e@example.com")
