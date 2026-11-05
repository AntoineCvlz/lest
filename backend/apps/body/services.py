"""Écritures du domaine `body` (ADR 0007, ADR 0008) : idempotentes, une pesée par compte et par
jour, une mensuration par compte, jour et endroit, des photos sous l'UUID du client."""

from datetime import date, timedelta
from decimal import Decimal
from enum import Enum
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.services import lock_account
from apps.body import photos
from apps.body.models import (
    MAX_LENGTH_M,
    MAX_PHOTOS,
    MAX_WEIGHT_KG,
    MIN_LENGTH_M,
    MIN_WEIGHT_KG,
    BodyMeasurement,
    BodyWeight,
    Pose,
    ProgressPhoto,
    Site,
    WeightSource,
)

EARLIEST = date(2000, 1, 1)


class NotFoundError(Exception):
    """Identifiant d'un autre compte : répondu comme un identifiant inconnu (404)."""


class WriteConflictError(Exception):
    """Deux premiers envois simultanés du même identifiant : le second est à rejouer."""


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
            owner=owner, date=day, defaults={"weight_kg": weight_kg, "source": WeightSource.MANUAL}
        )


class ScaleOutcome(Enum):
    CREATED = "created"
    UPDATED = "updated"
    KEPT_MANUAL = "kept_manual"


def import_scale_weight(*, owner: User, day: date, weight_kg: Decimal) -> ScaleOutcome:
    """Pesée d'une balance de club (Basic-Fit, ADR 0014) pour le jour `day` de `owner`.

    Remplit un jour sans pesée, ou suit sa balance sur un jour qu'elle a déjà rempli ; une pesée
    saisie à la main n'est jamais remplacée (choix produit). Lève `ValidationError` (date ou
    poids hors plage, sans la valeur)."""
    _check_day(day)
    if not MIN_WEIGHT_KG <= weight_kg <= MAX_WEIGHT_KG:
        raise ValidationError(
            {"weight_kg": ValidationError("Poids hors plage.", code="out_of_range")}
        )
    with transaction.atomic():
        row = BodyWeight.objects.select_for_update().filter(owner=owner, date=day).first()
        if row is None:
            try:
                # Point de sauvegarde : une saisie manuelle arrivée entre la lecture et l'écriture
                # ne fait pas échouer la synchro (ni journaliser la date de la pesée).
                with transaction.atomic():
                    BodyWeight.objects.create(
                        owner=owner, date=day, weight_kg=weight_kg, source=WeightSource.BASICFIT
                    )
                return ScaleOutcome.CREATED
            except IntegrityError:
                row = BodyWeight.objects.select_for_update().get(owner=owner, date=day)
        if row.source == WeightSource.MANUAL:
            return ScaleOutcome.KEPT_MANUAL
        row.weight_kg = weight_kg
        row.save(update_fields=["weight_kg", "updated_at"])
        return ScaleOutcome.UPDATED


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


def put_photo(
    *, owner: User, photo_id: UUID, day: date, pose: str, data: bytes
) -> tuple[ProgressPhoto, bool]:
    """Enregistre la photo `photo_id` de `owner`, ou la remplace (date, pose et image).

    L'image est vérifiée et réencodée sans métadonnées, puis chiffrée sur le disque avant
    l'écriture en base ; les fichiers remplacés ou d'une écriture annulée sont effacés. Lève
    `ValidationError` (date, pose, image refusée, plafond), `NotFoundError` (photo d'un autre
    compte) ou `WriteConflictError`.
    """
    _check_day(day)
    if pose not in Pose.values:
        raise ValidationError({"pose": ValidationError("Pose inconnue.", code="invalid_choice")})
    try:
        images = photos.process(data)
    except photos.PhotoRejectedError as error:
        raise ValidationError(
            {"file": ValidationError("Image refusée.", code="invalid_image")}
        ) from error
    key = photos.store(images)
    try:
        with transaction.atomic():
            # Sérialise les envois du compte : le plafond ne peut pas être dépassé à deux.
            lock_account(owner)
            existing = ProgressPhoto.objects.select_for_update().filter(pk=photo_id).first()
            if existing is not None and existing.owner_id != owner.pk:
                raise NotFoundError
            if existing is None and ProgressPhoto.objects.filter(owner=owner).count() >= MAX_PHOTOS:
                raise ValidationError(
                    {"photo_id": ValidationError("Plafond atteint.", code="too_many")}
                )
            photo = existing or ProgressPhoto(id=photo_id, owner=owner)
            if existing is not None:
                replaced = existing.file_key
                transaction.on_commit(lambda: photos.remove(replaced))
            photo.date, photo.pose, photo.file_key = day, pose, key
            photo.save(force_insert=existing is None)
    except IntegrityError as error:
        photos.remove(key)
        raise WriteConflictError from error
    except BaseException:
        photos.remove(key)
        raise
    return photo, existing is None


def delete_photo(*, owner: User, photo_id: UUID) -> None:
    """Supprime la photo `photo_id` de `owner` ; sans effet si elle n'existe pas ou appartient
    à un autre compte. Les fichiers sont effacés après validation (`receivers`)."""
    ProgressPhoto.objects.filter(owner=owner, pk=photo_id).delete()
