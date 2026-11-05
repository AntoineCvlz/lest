"""Pesées, mensurations (ADR 0007) et photos (ADR 0008) : `PUT` et `DELETE` idempotents sur la
date (et l'endroit mesuré) ou l'UUID du client pour les photos, lecture par période bornée.

Routers minces : schémas Pydantic, appel du service ou du selector. Une erreur de validation ne
renvoie jamais la valeur saisie (donnée de santé, `common.problems`).
"""

from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from typing import Literal

from allauth.core import ratelimit
from django.core.cache import cache
from django.http import Http404, HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils import timezone
from ninja import Field, Query, Router, Schema, Status
from pydantic import UUID4

from apps.accounts.models import User
from apps.body import photos, selectors, services
from apps.body.models import (
    MAX_LENGTH_M,
    MAX_WEIGHT_KG,
    MIN_LENGTH_M,
    MIN_WEIGHT_KG,
    BodyMeasurement,
    BodyWeight,
)
from common.auth import request_user
from common.period import Period
from common.problems import ProblemError

router = Router(tags=["body"])

RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
WRITE_CONFLICT_TYPE = "urn:lest:problem:write-conflict"
# Envois de photos par compte (`ACCOUNT_RATE_LIMITS`) : réencodage coûteux.
PHOTO_WRITE_ACTION = "body_photo_write"
# Archives de photos par compte : chaque archive déchiffre toutes les photos.
PHOTO_EXPORT_ACTION = "body_photo_export"
ARCHIVE_LOCK_PREFIX = "body:photo-archive:"
# Rendu à la fin du flux ; l'expiration ne sert que si le processus meurt en route.
ARCHIVE_LOCK_SECONDS = 15 * 60
PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")
UNSUPPORTED_TYPE = "urn:lest:problem:unsupported-media-type"
TOO_LARGE_TYPE = "urn:lest:problem:payload-too-large"
# Écritures du domaine `body` par compte (`ACCOUNT_RATE_LIMITS`).
WRITE_ACTION = "body_write"


class WeightIn(Schema):
    weight_kg: Decimal = Field(ge=MIN_WEIGHT_KG, le=MAX_WEIGHT_KG, max_digits=5, decimal_places=2)


class WeightOut(Schema):
    date: date
    weight_kg: float


class WeightPointOut(Schema):
    date: date
    weight_kg: float
    # Moyenne des pesées des 7 derniers jours, jour compris.
    trend_kg: float
    # Saisie à la main, ou balance Basic-Fit (ADR 0014).
    source: Literal["manual", "basicfit"]


# Valeurs de `Site` (un test vérifie qu'elles restent alignées) : énumération dans l'OpenAPI.
SiteName = Literal["neck", "chest", "waist", "hips", "arm", "thigh", "calf"]


class MeasurementIn(Schema):
    length_m: Decimal = Field(ge=MIN_LENGTH_M, le=MAX_LENGTH_M, max_digits=4, decimal_places=3)


class MeasurementOut(Schema):
    date: date
    site: SiteName
    length_m: float


PoseName = Literal["front", "side", "back"]


class PhotoOut(Schema):
    id: UUID4
    date: date
    pose: PoseName


class PhotoQuery(Schema):
    date: date
    pose: PoseName


def _writer(
    request: HttpRequest,
    action: str = WRITE_ACTION,
    message: str = "Trop d'écritures. Réessayez dans un instant.",
) -> User:
    """Compte qui écrit (ou exporte), après sa limite de débit (429 au-delà). `limit_get` :
    allauth ne compte pas les GET par défaut, or l'archive des photos en est un ; seul
    `consume_or_429` le transmet (la réponse 429 d'allauth est remplacée par la nôtre)."""
    user = request_user(request)
    if ratelimit.consume_or_429(request, action=action, user=user, limit_get=True) is not None:
        raise ProblemError(429, message, type_=RATE_LIMITED_TYPE)
    return user


def _weight_out(weight: BodyWeight) -> WeightOut:
    return WeightOut(date=weight.date, weight_kg=float(weight.weight_kg or 0))


@router.get("/body-weights/", response=list[WeightPointOut], summary="Pesées d'une période")
def list_weights(request: HttpRequest, period: Query[Period]) -> list[WeightPointOut]:
    start, end = period.bounds()
    points = selectors.list_weights(owner=request_user(request), start=start, end=end)
    return [
        WeightPointOut.model_validate(
            {
                "date": p.date,
                "weight_kg": float(p.weight_kg),
                "trend_kg": float(p.trend_kg),
                "source": p.source,
            }
        )
        for p in points
    ]


@router.put(
    "/body-weights/{day}/",
    response={200: WeightOut, 201: WeightOut},
    summary="Enregistrer ou remplacer la pesée d'un jour",
)
def write_weight(request: HttpRequest, day: date, payload: WeightIn) -> Status[WeightOut]:
    weight, created = services.put_weight(
        owner=_writer(request), day=day, weight_kg=payload.weight_kg
    )
    return Status(201 if created else 200, _weight_out(weight))


@router.delete("/body-weights/{day}/", response={204: None}, summary="Supprimer la pesée d'un jour")
def remove_weight(request: HttpRequest, day: date) -> Status[None]:
    services.delete_weight(owner=_writer(request), day=day)
    return Status(204, None)


def _measurement_out(row: BodyMeasurement) -> MeasurementOut:
    return MeasurementOut.model_validate(
        {"date": row.date, "site": row.site, "length_m": float(row.length_m or 0)}
    )


@router.get(
    "/body-measurements/", response=list[MeasurementOut], summary="Mensurations d'une période"
)
def list_measurements(request: HttpRequest, period: Query[Period]) -> list[MeasurementOut]:
    start, end = period.bounds()
    points = selectors.list_measurements(owner=request_user(request), start=start, end=end)
    return [
        MeasurementOut.model_validate(
            {"date": p.date, "site": p.site, "length_m": float(p.length_m)}
        )
        for p in points
    ]


@router.put(
    "/body-measurements/{day}/{site}/",
    response={200: MeasurementOut, 201: MeasurementOut},
    summary="Enregistrer ou remplacer une mensuration",
)
def write_measurement(
    request: HttpRequest, day: date, site: SiteName, payload: MeasurementIn
) -> Status[MeasurementOut]:
    row, created = services.put_measurement(
        owner=_writer(request), day=day, site=site, length_m=payload.length_m
    )
    return Status(201 if created else 200, _measurement_out(row))


@router.delete(
    "/body-measurements/{day}/{site}/", response={204: None}, summary="Supprimer une mensuration"
)
def remove_measurement(request: HttpRequest, day: date, site: SiteName) -> Status[None]:
    services.delete_measurement(owner=_writer(request), day=day, site=site)
    return Status(204, None)


def _photo_out(photo: object) -> PhotoOut:
    return PhotoOut.model_validate(photo, from_attributes=True)


def _upload(request: HttpRequest) -> bytes:
    """Octets envoyés, bornés avant lecture (413) ; type annoncé sur liste blanche (415).

    Le contenu réel est vérifié ensuite par Pillow : le type annoncé ne fait que refuser tôt.
    """
    content_type = request.content_type or ""
    if content_type not in PHOTO_TYPES:
        raise ProblemError(415, "Envoyez une photo JPEG, PNG ou WebP.", type_=UNSUPPORTED_TYPE)
    try:
        declared = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        declared = 0
    if declared > photos.MAX_UPLOAD_BYTES:
        raise ProblemError(413, "Photo trop lourde (15 Mo au plus).", type_=TOO_LARGE_TYPE)
    data = request.read(photos.MAX_UPLOAD_BYTES + 1)
    if len(data) > photos.MAX_UPLOAD_BYTES:
        raise ProblemError(413, "Photo trop lourde (15 Mo au plus).", type_=TOO_LARGE_TYPE)
    return data


@router.get("/progress-photos/", response=list[PhotoOut], summary="Photos d'une période")
def list_photos(request: HttpRequest, period: Query[Period]) -> list[PhotoOut]:
    start, end = period.bounds()
    return [
        _photo_out(photo)
        for photo in selectors.list_photos(owner=request_user(request), start=start, end=end)
    ]


# Déclarée avant `/progress-photos/{photo_id}/` : sinon « archive » y serait pris pour un id.
@router.get(
    "/progress-photos/archive/",
    response={200: None},
    summary="Télécharger toutes ses photos (archive ZIP, RGPD)",
    openapi_extra={
        # Clé entière comme celles de Ninja (sinon le tri des clés du schéma échoue).
        "responses": {
            200: {
                "description": "Archive ZIP des grandes images WebP",
                "content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}},
            }
        }
    },
)
def photo_archive(request: HttpRequest) -> StreamingHttpResponse:
    owner = _writer(
        request, PHOTO_EXPORT_ACTION, "Trop d'archives demandées. Réessayez dans une heure."
    )
    # Une archive à la fois par compte : un client lent ne bloque pas plusieurs workers.
    lock = f"{ARCHIVE_LOCK_PREFIX}{owner.pk}"
    if not cache.add(lock, 1, timeout=ARCHIVE_LOCK_SECONDS):
        raise ProblemError(429, "Une archive est déjà en préparation.", type_=RATE_LIMITED_TYPE)
    entries = selectors.photo_archive_entries(owner=owner)

    def stream() -> Iterator[bytes]:
        try:
            yield from photos.archive(entries)
        finally:
            # Fin du flux ou client parti (`close` du générateur) : le verrou est rendu.
            cache.delete(lock)

    response = StreamingHttpResponse(stream(), content_type="application/zip")
    filename = f"lest-photos-{timezone.localdate():%Y-%m-%d}.zip"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    # Données de santé : jamais en cache.
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@router.put(
    "/progress-photos/{photo_id}/",
    response={200: PhotoOut, 201: PhotoOut},
    summary="Envoyer ou remplacer une photo de progression",
    description=(
        "Corps : l'image elle-même (JPEG, PNG ou WebP, 15 Mo au plus), en `Content-Type` "
        "`image/*`. Réencodée en WebP sans métadonnées, puis chiffrée (ADR 0008)."
    ),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                kind: {"schema": {"type": "string", "format": "binary"}} for kind in PHOTO_TYPES
            },
        }
    },
)
def write_photo(
    request: HttpRequest, photo_id: UUID4, query: Query[PhotoQuery]
) -> Status[PhotoOut]:
    owner = _writer(request, PHOTO_WRITE_ACTION)
    data = _upload(request)
    try:
        photo, created = services.put_photo(
            owner=owner, photo_id=photo_id, day=query.date, pose=query.pose, data=data
        )
    except services.NotFoundError as error:
        raise Http404 from error
    except services.WriteConflictError as error:
        raise ProblemError(
            409, "Écriture refusée, réessayez.", type_=WRITE_CONFLICT_TYPE
        ) from error
    return Status(201 if created else 200, _photo_out(photo))


@router.get(
    "/progress-photos/{photo_id}/{size}/",
    response={200: None},
    summary="Image d'une photo de progression (WebP)",
    openapi_extra={
        # Clé entière comme celles de Ninja (sinon le tri des clés du schéma échoue).
        "responses": {
            200: {
                "description": "Image WebP",
                "content": {"image/webp": {"schema": {"type": "string", "format": "binary"}}},
            }
        }
    },
)
def photo_image(request: HttpRequest, photo_id: UUID4, size: photos.Size) -> HttpResponse:
    try:
        content = selectors.photo_image(owner=request_user(request), photo_id=photo_id, size=size)
    except selectors.PhotoNotFoundError as error:
        raise Http404 from error
    response = HttpResponse(content, content_type="image/webp")
    # Donnée de santé : jamais en cache, ni partagé ni local.
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@router.delete("/progress-photos/{photo_id}/", response={204: None}, summary="Supprimer une photo")
def remove_photo(request: HttpRequest, photo_id: UUID4) -> Status[None]:
    services.delete_photo(owner=_writer(request), photo_id=photo_id)
    return Status(204, None)
