"""Période de lecture bornée, commune aux domaines (corps, activités) : de 2000 à demain, début
avant fin, 366 jours au plus, les 90 derniers jours par défaut."""

from datetime import date, timedelta
from typing import Self

from django.utils import timezone
from ninja import Schema
from pydantic import model_validator

EARLIEST = date(2000, 1, 1)
DEFAULT_PERIOD_DAYS = 90
MAX_PERIOD_DAYS = 366


class Period(Schema):
    start: date | None = None
    end: date | None = None

    def bounds(self) -> tuple[date, date]:
        end = self.end or timezone.localdate()
        return self.start or end - timedelta(days=DEFAULT_PERIOD_DAYS - 1), end

    @model_validator(mode="after")
    def _bounded(self) -> Self:
        start, end = self.bounds()
        # Mêmes bornes qu'à l'écriture : une date extrême ferait déborder les calculs glissants.
        latest = timezone.localdate() + timedelta(days=1)
        if not (
            EARLIEST <= start <= end <= latest and end - start < timedelta(days=MAX_PERIOD_DAYS)
        ):
            msg = "Période invalide : de 2000 à demain, début avant fin, 366 jours au plus."
            raise ValueError(msg)
        return self
