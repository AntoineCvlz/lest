import pytest
from django.test import Client
from django.urls import reverse

from apps.accounts.tests.factories import make_user

pytestmark = pytest.mark.django_db


def test_admin_lists_and_shows_users_without_exposing_the_password_hash(client: Client) -> None:
    admin = make_user(is_staff=True, is_superuser=True)
    member = make_user(email="membre@example.com")
    client.force_login(admin)

    changelist = client.get(reverse("admin:accounts_user_changelist"))
    change = client.get(reverse("admin:accounts_user_change", args=[member.pk]))

    assert changelist.status_code == 200
    assert "membre@example.com" in changelist.content.decode()
    assert change.status_code == 200
    assert member.password not in change.content.decode()


def test_admin_requires_staff(client: Client) -> None:
    client.force_login(make_user())

    response = client.get(reverse("admin:accounts_user_changelist"))

    assert response.status_code == 302
