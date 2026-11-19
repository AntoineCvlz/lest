"""Séances de cardio de démonstration (dev seulement) : 8 semaines de course et de natation à
côté de la musculation (reprend l'ancien seed des activités, ADR 0017). Plan déterministe,
identifiants stables (ADR 0003) : rejouer le seed remplace."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from django.utils import timezone

from common.demo import draw, stable_id

from .services import CardioValues

WEEKS = 8
# Dimanche : course ; un mardi sur deux : natation. Midi, heure locale.
RUN_DAY, SWIM_DAY = 6, 1


@dataclass(frozen=True)
class PlannedCardio:
    id: UUID
    values: CardioValues


def _noon(day: date) -> datetime:
    return datetime.combine(day, time(12), tzinfo=timezone.get_current_timezone())


def plan(*, today: date) -> list[PlannedCardio]:
    """Séances de cardio des `WEEKS` dernières semaines, avant aujourd'hui."""
    monday = today - timedelta(days=today.weekday())
    sessions = []
    for week in range(WEEKS):
        start = monday - timedelta(weeks=WEEKS - week)
        run_day = start + timedelta(days=RUN_DAY)
        if run_day < today:
            km = Decimal(5) + Decimal(week) / 2 + Decimal(round(draw("course", week), 1))
            sessions.append(
                PlannedCardio(
                    id=stable_id("cardio", "course", run_day),
                    values=CardioValues(
                        sport="running",
                        started_at=_noon(run_day),
                        duration_s=int(km * Decimal("5.8")) * 60,
                        distance_m=(km * 1000).quantize(Decimal(1)),
                        avg_heart_rate=145 + int(draw("fc", week) * 15),
                        feeling=3 + int(draw("ressenti", week) * 3),
                        note=f"Dénivelé positif : {40 + int(draw('denivele', week) * 80)} m",
                    ),
                )
            )
        swim_day = start + timedelta(days=SWIM_DAY)
        if week % 2 == 0 and swim_day < today:
            laps = 40 + 4 * week
            sessions.append(
                PlannedCardio(
                    id=stable_id("cardio", "natation", swim_day),
                    values=CardioValues(
                        sport="swimming",
                        started_at=_noon(swim_day),
                        duration_s=(30 + week) * 60,
                        distance_m=Decimal(laps * 25),
                        feeling=4,
                        note=f"Longueurs : {laps}\nLongueur du bassin : 25 m",
                    ),
                )
            )
    return sessions
