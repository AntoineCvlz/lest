"""Écritures du domaine `body` (ADR 0007) : idempotentes, une pesée par compte et par jour, une
mensuration par compte, jour et endroit."""

from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.body.models import (
    MAX_LENGTH_M,
    MAX_WEIGHT_KG,
    MIN_LENGTH_M,
    MIN_WEIGHT_KG,
    BodyMeasurement,
    BodyWeight,
    Site,
)

EARLIEST = date(2000, 1, 1)


def _check_day(day: date) -> None:
    # Une horloge déréglée ne doit pas écrire une date absurde : de 2000 à demain au plus tard.
    if not EARLIEST <= day <= timezone.localdate() + timedelta(days=1):
        raise ValidationError({"date": ValidationError("Date hors plage.", code="out_of_range")})


def put_weight(*, owner: User, day: date, weight_kg: Decimal) -> tuple[BodyWeight, bool]:
    """Enregistre la pesée du jour `day` de `owner`, ou remplace celle qui existe.

    Renvoie la pesée et `True` si elle est créée. Un rejeu (file hors ligne) ou une saisie depuis
    un autre appareil converge vers la dernière écriture. Lève `ValidationError` (champs et codes,
    sans la valeur) pour une date ou un poids hors plage.
    """
    _check_day(day)
    if not MIN_WEIGHT_KG <= weight_kg <= MAX_WEIGHT_KG:
        raise ValidationError(
            {"weight_kg": ValidationError("Poids hors plage.", code="out_of_range")}
        )
    with transaction.atomic():
        return BodyWeight.objects.update_or_create(
            owner=owner, date=day, defaults={"weight_kg": weight_kg}
        )


def delete_weight(*, owner: User, day: date) -> None:
    """Supprime la pesée du jour `day` de `owner` ; sans effet si elle n'existe pas (idempotent),
    y compris quand seul un autre compte a une pesée ce jour-là."""
    BodyWeight.objects.filter(owner=owner, date=day).delete()


def put_measurement(
    *, owner: User, day: date, site: str, length_m: Decimal
) -> tuple[BodyMeasurement, bool]:
    """Enregistre la mensuration `site` du jour `day` de `owner`, ou remplace celle qui existe.

    Renvoie la mensuration et `True` si elle est créée. Lève `ValidationError` (champs et codes,
    sans la valeur) pour une date, un endroit ou une longueur hors plage.
    """
    _check_day(day)
    if site not in Site.values:
        raise ValidationError({"site": ValidationError("Endroit inconnu.", code="invalid_choice")})
    if not MIN_LENGTH_M <= length_m <= MAX_LENGTH_M:
        raise ValidationError(
            {"length_m": ValidationError("Longueur hors plage.", code="out_of_range")}
        )
    with transaction.atomic():
        return BodyMeasurement.objects.update_or_create(
            owner=owner, date=day, site=site, defaults={"length_m": length_m}
        )


def delete_measurement(*, owner: User, day: date, site: str) -> None:
    """Supprime la mensuration `site` du jour `day` de `owner` ; sans effet si elle n'existe pas."""
    BodyMeasurement.objects.filter(owner=owner, date=day, site=site).delete()
