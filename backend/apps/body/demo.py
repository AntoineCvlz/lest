"""Pesées et mensurations de démonstration (dev seulement) : 8 semaines de prise de masse.

Plan déterministe : relancer le seed remplace les mêmes jours (clés naturelles, ADR 0007) au
lieu de dupliquer. Le poids monte d'environ 2 kg, avec les variations d'un jour à l'autre et
quelques jours sans pesée, comme une vraie courbe.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from apps.body.models import Site
from common.demo import draw

DAYS = 56
START_KG = Decimal("76.0")
GAIN_KG = Decimal("2.0")
# Écart d'un jour à l'autre (eau, repas) : ± 0,4 kg autour de la tendance.
NOISE_KG = Decimal("0.8")
SKIPPED = 0.15
MEASURE_EVERY = 14
# Début et fin de chaque mensuration, en mètres.
SITES: dict[str, tuple[Decimal, Decimal]] = {
    Site.CHEST: (Decimal("1.000"), Decimal("1.025")),
    Site.WAIST: (Decimal("0.820"), Decimal("0.830")),
    Site.ARM: (Decimal("0.360"), Decimal("0.375")),
    Site.THIGH: (Decimal("0.580"), Decimal("0.595")),
}


@dataclass(frozen=True)
class PlannedWeight:
    day: date
    weight_kg: Decimal


@dataclass(frozen=True)
class PlannedMeasurement:
    day: date
    site: str
    length_m: Decimal


def weights(*, today: date) -> list[PlannedWeight]:
    """Une pesée par jour sur `DAYS` jours jusqu'à aujourd'hui, sauf quelques oublis."""
    plan = []
    for index in range(DAYS):
        day = today - timedelta(days=DAYS - 1 - index)
        if index not in (0, DAYS - 1) and draw("pesée-oubliée", index) < SKIPPED:
            continue
        trend = START_KG + GAIN_KG * index / (DAYS - 1)
        noise = NOISE_KG * Decimal(str(round(draw("pesée", index) - 0.5, 3)))
        plan.append(PlannedWeight(day=day, weight_kg=(trend + noise).quantize(Decimal("0.1"))))
    return plan


def measurements(*, today: date) -> list[PlannedMeasurement]:
    """Mensurations toutes les deux semaines, au demi-centimètre, jusqu'à aujourd'hui."""
    sessions = (DAYS - 1) // MEASURE_EVERY
    plan = []
    for session in range(sessions + 1):
        day = today - timedelta(days=(sessions - session) * MEASURE_EVERY)
        for site, (start, end) in SITES.items():
            length = start + (end - start) * session / sessions
            half_cm = (length / Decimal("0.005")).quantize(Decimal(1)) * Decimal("0.005")
            plan.append(PlannedMeasurement(day=day, site=site, length_m=half_cm))
    return plan
