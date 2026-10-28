import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.accounts.models import Goal, Profile, User

pytestmark = pytest.mark.django_db

PASSWORD = "Barre-de-demo-2026"  # gitleaks:allow — mot de passe de test, pas un secret


@pytest.fixture
def password(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("LEST_USER_PASSWORD", PASSWORD)
    return PASSWORD


@override_settings(DEBUG=True)
def test_creates_a_verified_demo_account_with_a_profile(password: str) -> None:
    call_command("seed_demo")

    user = User.objects.get(email="demo@example.com")
    assert user.check_password(password)
    assert user.emailaddress_set.get().verified  # type: ignore[attr-defined]
    profile = Profile.objects.get(user=user)
    assert profile.goal == Goal.GAIN


@override_settings(DEBUG=True)
def test_running_it_again_changes_nothing(password: str) -> None:
    call_command("seed_demo")
    call_command("seed_demo")

    assert User.objects.count() == 1
    assert Profile.objects.count() == 1


@override_settings(DEBUG=False)
def test_refuses_to_run_outside_development(password: str) -> None:
    with pytest.raises(CommandError, match="DEBUG"):
        call_command("seed_demo")

    assert not User.objects.exists()


@override_settings(DEBUG=True)
def test_requires_the_password_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LEST_USER_PASSWORD", raising=False)

    with pytest.raises(CommandError, match="LEST_USER_PASSWORD"):
        call_command("seed_demo")
