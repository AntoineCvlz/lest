"""Pesées (ADR 0007) : valeur chiffrée en base, une par jour, moyenne mobile sur 7 jours."""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.body import selectors, services
from apps.body.models import BodyWeight
from common import crypto

pytestmark = pytest.mark.django_db

DAY = date(2026, 10, 1)


def weigh(owner: User, offset: int, kg: str) -> None:
    services.put_weight(owner=owner, day=DAY + timedelta(days=offset), weight_kg=Decimal(kg))


def stored_value(weight: BodyWeight) -> str:
    with connection.cursor() as cursor:
        cursor.execute("SELECT weight_kg FROM body_bodyweight WHERE id = %s", [weight.pk])
        raw: str = cursor.fetchone()[0]
    return raw


def test_the_weight_is_encrypted_at_rest() -> None:
    user = make_verified_user()
    weight, created = services.put_weight(owner=user, day=DAY, weight_kg=Decimal("81.4"))

    raw = stored_value(weight)
    assert created
    assert "81" not in raw
    assert crypto.decrypt(raw) == "81.40"
    assert BodyWeight.objects.get(pk=weight.pk).weight_kg == Decimal("81.40")


def test_the_ciphertext_length_does_not_reveal_the_weight() -> None:
    user = make_verified_user()
    light, _ = services.put_weight(owner=user, day=DAY, weight_kg=Decimal(45))
    heavy, _ = services.put_weight(owner=user, day=DAY + timedelta(days=1), weight_kg=Decimal(140))

    assert len(stored_value(light)) == len(stored_value(heavy))


def test_a_second_weighing_the_same_day_replaces_the_first() -> None:
    user = make_verified_user()
    services.put_weight(owner=user, day=DAY, weight_kg=Decimal(80))
    weight, created = services.put_weight(owner=user, day=DAY, weight_kg=Decimal("80.6"))

    assert not created
    assert BodyWeight.objects.filter(owner=user).count() == 1
    assert BodyWeight.objects.get(pk=weight.pk).weight_kg == Decimal("80.60")


def test_one_weighing_per_day_is_enforced_by_the_database() -> None:
    user = make_verified_user()
    services.put_weight(owner=user, day=DAY, weight_kg=Decimal(80))

    with pytest.raises(IntegrityError), transaction.atomic():
        BodyWeight.objects.create(owner=user, date=DAY, weight_kg=Decimal(81))


@pytest.mark.parametrize("kg", ["19.99", "400.01", "-1"])
def test_an_implausible_weight_is_refused(kg: str) -> None:
    user = make_verified_user()

    with pytest.raises(ValidationError) as error:
        services.put_weight(owner=user, day=DAY, weight_kg=Decimal(kg))

    assert error.value.message_dict.keys() == {"weight_kg"}
    assert not BodyWeight.objects.exists()


@pytest.mark.parametrize("offset", [None, 2])
def test_an_implausible_day_is_refused(offset: int | None) -> None:
    user = make_verified_user()
    # Avant 2000, ou après demain.
    day = date(1999, 12, 31) if offset is None else timezone.localdate() + timedelta(days=offset)

    with pytest.raises(ValidationError) as error:
        services.put_weight(owner=user, day=day, weight_kg=Decimal(80))

    assert error.value.message_dict.keys() == {"date"}


def test_the_field_only_accepts_decimals() -> None:
    user = make_verified_user()

    with pytest.raises(TypeError):
        BodyWeight.objects.create(owner=user, date=DAY, weight_kg="80")  # type: ignore[misc]  # volontaire


def test_the_trend_averages_the_weighings_of_the_last_seven_days() -> None:
    user = make_verified_user()
    weigh(user, 0, "80")
    weigh(user, 1, "81")
    weigh(user, 3, "82.5")
    weigh(user, 8, "84")

    points = selectors.list_weights(owner=user, start=DAY, end=DAY + timedelta(days=8))

    assert [(p.date.day, p.weight_kg, p.trend_kg) for p in points] == [
        (1, Decimal("80.00"), Decimal("80.00")),
        (2, Decimal("81.00"), Decimal("80.50")),
        (4, Decimal("82.50"), Decimal("81.17")),
        # Fenêtre du 3 au 9 : le 4 et le 9 seulement.
        (9, Decimal("84.00"), Decimal("83.25")),
    ]


def test_the_trend_uses_weighings_before_the_period() -> None:
    user = make_verified_user()
    weigh(user, 0, "80")
    weigh(user, 6, "82")
    weigh(user, 7, "84")

    points = selectors.list_weights(
        owner=user, start=DAY + timedelta(days=6), end=DAY + timedelta(days=7)
    )

    assert [(p.date.day, p.trend_kg) for p in points] == [
        (7, Decimal("81.00")),
        (8, Decimal("83.00")),
    ]


def test_listing_never_shows_another_accounts_weighings() -> None:
    owner, other = make_verified_user(), make_verified_user()
    weigh(owner, 0, "80")
    weigh(other, 0, "60")

    points = selectors.list_weights(owner=other, start=DAY, end=DAY)

    assert [p.weight_kg for p in points] == [Decimal("60.00")]


def test_deleting_is_idempotent_and_scoped_to_the_owner() -> None:
    owner, other = make_verified_user(), make_verified_user()
    weigh(owner, 0, "80")

    services.delete_weight(owner=other, day=DAY)
    assert BodyWeight.objects.filter(owner=owner).exists()
    services.delete_weight(owner=owner, day=DAY)
    services.delete_weight(owner=owner, day=DAY)
    assert not BodyWeight.objects.exists()


def test_weighings_are_exported_in_clear_and_deleted_with_the_account() -> None:
    user = make_verified_user()
    weigh(user, 0, "80.5")

    assert export_account(user)["body_weights"] == [
        {"date": "2026-10-01", "weight_kg": 80.5, "source": "manual"}
    ]
    delete_account(user=user, password=TEST_PASSWORD)
    assert not BodyWeight.objects.exists()
