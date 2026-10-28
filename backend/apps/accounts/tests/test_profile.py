"""Profil : taille (SI), objectif, unités d'affichage ; un seul par compte."""

import threading
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction

from apps.accounts.models import Goal, Profile, UnitSystem
from apps.accounts.selectors import get_profile
from apps.accounts.services import save_profile
from apps.accounts.tests.factories import make_user

pytestmark = pytest.mark.django_db


def test_a_new_account_has_no_profile_until_onboarding() -> None:
    assert get_profile(make_user()) is None


def test_save_profile_creates_then_updates_the_single_profile() -> None:
    user = make_user()

    created = save_profile(user=user, height_m=1.8, goal=Goal.GAIN, unit_system=UnitSystem.METRIC)
    onboarded_at = created.onboarded_at
    updated = save_profile(user=user, height_m=1.81, goal=Goal.CUT, unit_system=UnitSystem.IMPERIAL)

    assert Profile.objects.count() == 1
    assert (updated.height_m, updated.goal, updated.unit_system) == (
        Decimal("1.81"),
        Goal.CUT,
        UnitSystem.IMPERIAL,
    )
    assert updated.onboarded_at == onboarded_at  # l'onboarding reste daté de sa fin


def test_height_is_stored_in_metres_to_the_centimetre() -> None:
    profile = save_profile(
        user=make_user(), height_m=1.7849, goal=Goal.MAINTAIN, unit_system=UnitSystem.METRIC
    )

    assert profile.height_m == Decimal("1.78")


@pytest.mark.parametrize("height_m", [0.99, 2.51])
def test_save_profile_refuses_an_implausible_height(height_m: float) -> None:
    with pytest.raises(ValidationError):
        save_profile(
            user=make_user(), height_m=height_m, goal=Goal.GAIN, unit_system=UnitSystem.METRIC
        )

    assert not Profile.objects.exists()


def test_selector_only_returns_the_owner_profile() -> None:
    alice, bob = make_user(), make_user()
    save_profile(user=alice, height_m=1.65, goal=Goal.GAIN, unit_system=UnitSystem.METRIC)

    assert get_profile(bob) is None
    profile = get_profile(alice)
    assert profile is not None
    assert profile.user_id == alice.pk


@pytest.mark.parametrize(
    "fields",
    [
        {"height_m": Decimal("0.50"), "goal": Goal.GAIN, "unit_system": UnitSystem.METRIC},
        {"height_m": Decimal("1.80"), "goal": "bulk", "unit_system": UnitSystem.METRIC},
        {"height_m": Decimal("1.80"), "goal": Goal.GAIN, "unit_system": "si"},
    ],
)
def test_the_database_enforces_the_invariants(fields: dict[str, object]) -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Profile.objects.create(user=make_user(), **fields)


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_saves_create_a_single_profile() -> None:
    # Double tap sur « Terminer » (ou rejeu hors ligne) : deux créations simultanées.
    user = make_user()
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def save() -> None:
        barrier.wait()
        try:
            save_profile(user=user, height_m=1.8, goal=Goal.GAIN, unit_system=UnitSystem.METRIC)
        except BaseException as error:
            errors.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=save) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert Profile.objects.count() == 1
