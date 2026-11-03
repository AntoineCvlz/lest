"""Pesées (ADR 0007) : `PUT` et `DELETE` idempotents sur la date, lecture par période bornée.

Routers minces : schémas Pydantic, appel du service ou du selector. Une erreur de validation ne
renvoie jamais la valeur saisie (donnée de santé, `common.problems`).
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Self

from allauth.core import ratelimit
from django.http import HttpRequest
from django.utils import timezone
from ninja import Field, Query, Router, Schema, Status
from pydantic import model_validator

from apps.accounts.models import User
from apps.body import selectors, services
from apps.body.models import MAX_WEIGHT_KG, MIN_WEIGHT_KG, BodyWeight
from common.auth import request_user
from common.problems import ProblemError

router = Router(tags=["body"])

RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
# Écritures du domaine `body` par compte (`ACCOUNT_RATE_LIMITS`).
WRITE_ACTION = "body_write"
DEFAULT_PERIOD_DAYS = 90
MAX_PERIOD_DAYS = 366


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


class WeightPeriod(Schema):
    # Par défaut, les 90 derniers jours ; jamais plus de 366 jours d'un coup.
    start: date | None = None
    end: date | None = None

    def bounds(self) -> tuple[date, date]:
        end = self.end or timezone.localdate()
        return self.start or end - timedelta(days=DEFAULT_PERIOD_DAYS - 1), end

    @model_validator(mode="after")
    def _bounded(self) -> Self:
        start, end = self.bounds()
        # Mêmes bornes qu'à l'écriture : une date extrême ferait déborder la fenêtre de la moyenne.
        latest = timezone.localdate() + timedelta(days=1)
        if not (
            services.EARLIEST <= start <= end <= latest
            and end - start < timedelta(days=MAX_PERIOD_DAYS)
        ):
            msg = "Période invalide : de 2000 à demain, début avant fin, 366 jours au plus."
            raise ValueError(msg)
        return self


def _writer(request: HttpRequest) -> User:
    """Compte qui écrit, après la limite de débit des écritures (429 au-delà)."""
    user = request_user(request)
    if not ratelimit.consume(request, action=WRITE_ACTION, user=user):
        raise ProblemError(
            429, "Trop d'écritures. Réessayez dans un instant.", type_=RATE_LIMITED_TYPE
        )
    return user


def _weight_out(weight: BodyWeight) -> WeightOut:
    return WeightOut(date=weight.date, weight_kg=float(weight.weight_kg or 0))


@router.get("/body-weights/", response=list[WeightPointOut], summary="Pesées d'une période")
def list_weights(request: HttpRequest, period: Query[WeightPeriod]) -> list[WeightPointOut]:
    start, end = period.bounds()
    points = selectors.list_weights(owner=request_user(request), start=start, end=end)
    return [
        WeightPointOut(date=p.date, weight_kg=float(p.weight_kg), trend_kg=float(p.trend_kg))
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
