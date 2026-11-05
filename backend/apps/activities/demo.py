"""Activités de démonstration (dev seulement) : 8 semaines d'autres sports à côté de la
musculation. Plan déterministe (identifiants stables, ADR 0003) : rejouer le seed remplace."""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from common.demo import draw, stable_id

WEEKS = 8
# Dimanche : course ; un mardi sur deux : natation.
RUN_DAY, SWIM_DAY = 6, 1


@dataclass(frozen=True)
class PlannedActivity:
    id: UUID
    day: date
    sport: str
    duration_s: int
    distance_m: Decimal | None
    avg_heart_rate: int | None
    feeling: int | None
    metrics: dict[str, int] = field(default_factory=dict)


def plan(*, today: date) -> list[PlannedActivity]:
    """Activités des `WEEKS` dernières semaines, avant aujourd'hui."""
    monday = today - timedelta(days=today.weekday())
    activities = []
    for week in range(WEEKS):
        start = monday - timedelta(weeks=WEEKS - week)
        run_day = start + timedelta(days=RUN_DAY)
        if run_day < today:
            km = Decimal(5) + Decimal(week) / 2 + Decimal(round(draw("course", week), 1))
            minutes = int(km * Decimal("5.8"))
            activities.append(
                PlannedActivity(
                    id=stable_id("activite", "course", run_day),
                    day=run_day,
                    sport="running",
                    duration_s=minutes * 60,
                    distance_m=(km * 1000).quantize(Decimal(1)),
                    avg_heart_rate=145 + int(draw("fc", week) * 15),
                    feeling=3 + int(draw("ressenti", week) * 3),
                    metrics={"elevation_gain_m": 40 + int(draw("denivele", week) * 80)},
                )
            )
        swim_day = start + timedelta(days=SWIM_DAY)
        if week % 2 == 0 and swim_day < today:
            laps = 40 + 4 * week
            activities.append(
                PlannedActivity(
                    id=stable_id("activite", "natation", swim_day),
                    day=swim_day,
                    sport="swimming",
                    duration_s=(30 + week) * 60,
                    distance_m=Decimal(laps * 25),
                    avg_heart_rate=None,
                    feeling=4,
                    metrics={"pool_length_m": 25, "laps": laps},
                )
            )
    return activities
