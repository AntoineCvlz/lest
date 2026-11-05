"""Pesées venues d'une balance de club (ADR 0014) : elles remplissent les jours vides et suivent
leur balance, jamais elles ne remplacent une pesée saisie à la main."""

from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError

from apps.accounts.tests.factories import make_verified_user
from apps.body import selectors, services
from apps.body.models import BodyWeight, WeightSource

pytestmark = pytest.mark.django_db

DAY = date(2026, 10, 30)


def test_a_scale_weight_fills_an_empty_day() -> None:
    user = make_verified_user()

    outcome = services.import_scale_weight(owner=user, day=DAY, weight_kg=Decimal("80.4"))

    assert outcome == services.ScaleOutcome.CREATED
    row = BodyWeight.objects.get()
    assert (row.weight_kg, row.source) == (Decimal("80.40"), WeightSource.BASICFIT)


def test_a_manual_weigh_in_always_wins() -> None:
    user = make_verified_user()
    services.put_weight(owner=user, day=DAY, weight_kg=Decimal("81"))

    outcome = services.import_scale_weight(owner=user, day=DAY, weight_kg=Decimal("80.4"))

    assert outcome == services.ScaleOutcome.KEPT_MANUAL
    row = BodyWeight.objects.get()
    assert (row.weight_kg, row.source) == (Decimal("81.00"), WeightSource.MANUAL)


def test_a_scale_weight_follows_its_scale_and_a_manual_one_takes_over() -> None:
    user = make_verified_user()
    services.import_scale_weight(owner=user, day=DAY, weight_kg=Decimal("80.4"))

    assert (
        services.import_scale_weight(owner=user, day=DAY, weight_kg=Decimal("80.6"))
        == services.ScaleOutcome.UPDATED
    )
    services.put_weight(owner=user, day=DAY, weight_kg=Decimal("81"))

    assert BodyWeight.objects.get().source == WeightSource.MANUAL


@pytest.mark.parametrize("kg", ["19.9", "400.1"])
def test_an_out_of_range_scale_weight_is_refused(kg: str) -> None:
    with pytest.raises(ValidationError):
        services.import_scale_weight(owner=make_verified_user(), day=DAY, weight_kg=Decimal(kg))
    assert not BodyWeight.objects.exists()


def test_scale_weights_stay_per_account() -> None:
    me, other = make_verified_user(), make_verified_user()
    services.put_weight(owner=me, day=DAY, weight_kg=Decimal("81"))

    assert (
        services.import_scale_weight(owner=other, day=DAY, weight_kg=Decimal("70"))
        == services.ScaleOutcome.CREATED
    )
    assert BodyWeight.objects.get(owner=me).weight_kg == Decimal("81.00")


def test_the_source_is_shown_and_exported() -> None:
    user = make_verified_user()
    services.import_scale_weight(owner=user, day=DAY, weight_kg=Decimal("80.4"))

    [point] = selectors.list_weights(owner=user, start=DAY, end=DAY)
    assert point.source == WeightSource.BASICFIT
    assert selectors.export_weights(owner=user) == [
        {"date": "2026-10-30", "weight_kg": 80.4, "source": "basicfit"}
    ]
