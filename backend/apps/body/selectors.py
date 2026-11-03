"""Lectures du domaine `body`, toujours filtrées par propriétaire. Les valeurs sont déchiffrées
ici et les moyennes calculées en Python (ADR 0007)."""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from apps.accounts.models import User
from apps.body import photos
from apps.body.models import BodyMeasurement, BodyWeight, ProgressPhoto

# Moyenne mobile : le jour et les 6 précédents.
TREND_DAYS = 7
CENTI = Decimal("0.01")


@dataclass(frozen=True)
class WeightPoint:
    date: date
    weight_kg: Decimal
    # Moyenne des pesées des 7 derniers jours, jour compris (jours sans pesée ignorés).
    trend_kg: Decimal


def list_weights(*, owner: User, start: date, end: date) -> list[WeightPoint]:
    """Pesées de `owner` du `start` au `end` inclus, par date croissante, avec leur moyenne mobile.

    Les 6 jours qui précèdent `start` sont lus aussi : la moyenne du premier jour en dépend.
    """
    window = timedelta(days=TREND_DAYS - 1)
    rows = [
        (row.date, row.weight_kg)
        for row in BodyWeight.objects.filter(
            owner=owner, date__gte=start - window, date__lte=end
        ).only("date", "weight_kg")
    ]
    points = []
    for day, kg in rows:
        if day < start or kg is None:
            continue
        recent = [value for other, value in rows if day - window <= other <= day and value]
        trend = (sum(recent, Decimal(0)) / len(recent)).quantize(CENTI, rounding=ROUND_HALF_UP)
        points.append(WeightPoint(date=day, weight_kg=kg, trend_kg=trend))
    return points


@dataclass(frozen=True)
class MeasurementPoint:
    date: date
    site: str
    length_m: Decimal


def list_measurements(*, owner: User, start: date, end: date) -> list[MeasurementPoint]:
    """Mensurations de `owner` du `start` au `end` inclus, par date puis endroit."""
    return [
        MeasurementPoint(date=row.date, site=row.site, length_m=row.length_m)
        for row in BodyMeasurement.objects.filter(owner=owner, date__gte=start, date__lte=end)
        if row.length_m is not None
    ]


def export_measurements(*, owner: User) -> list[dict[str, Any]]:
    """Mensurations de `owner` en clair, pour l'export RGPD."""
    return [
        {"date": row.date.isoformat(), "site": row.site, "length_m": float(row.length_m)}
        for row in BodyMeasurement.objects.filter(owner=owner)
        if row.length_m is not None
    ]


def export_weights(*, owner: User) -> list[dict[str, Any]]:
    """Pesées de `owner` en clair, pour l'export RGPD."""
    return [
        {"date": row.date.isoformat(), "weight_kg": float(row.weight_kg)}
        for row in BodyWeight.objects.filter(owner=owner)
        if row.weight_kg is not None
    ]


class PhotoNotFoundError(Exception):
    """Photo inconnue, d'un autre compte, ou fichier manquant : 404 dans tous les cas."""


def list_photos(*, owner: User, start: date, end: date) -> list[ProgressPhoto]:
    """Photos de `owner` du `start` au `end` inclus, les plus anciennes d'abord."""
    return list(
        ProgressPhoto.objects.filter(owner=owner, date__gte=start, date__lte=end).only(
            "id", "date", "pose"
        )
    )


def photo_image(*, owner: User, photo_id: UUID, size: photos.Size) -> bytes:
    """Octets WebP déchiffrés d'une photo de `owner`, ou `PhotoNotFoundError`."""
    key = (
        ProgressPhoto.objects.filter(owner=owner, pk=photo_id)
        .values_list("file_key", flat=True)
        .first()
    )
    if key is None:
        raise PhotoNotFoundError
    try:
        return photos.read(key, size)
    except FileNotFoundError as error:
        raise PhotoNotFoundError from error


def export_photos(*, owner: User) -> list[dict[str, Any]]:
    """Métadonnées des photos de `owner` pour l'export RGPD (images : archive dédiée, ADR 0008)."""
    return [
        {"id": str(row.id), "date": row.date.isoformat(), "pose": row.pose}
        for row in ProgressPhoto.objects.filter(owner=owner)
    ]
