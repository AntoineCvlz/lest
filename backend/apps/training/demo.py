"""Séances de démonstration (dev seulement) : 8 semaines réalistes pour le compte démo.

Plan déterministe (même graine, mêmes identifiants) : relancer le seed remplace les séances au
lieu de les dupliquer, grâce aux écritures idempotentes (ADR 0003). Les charges progressent
d'une semaine à l'autre, avec quelques séances moins bonnes, comme un vrai carnet.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from common.demo import draw as _draw
from common.demo import stable_id as _id

WEEKS = 8
# Lundi, mercredi, vendredi à 18 h, heure de Paris.
DAYS = (0, 2, 4)
START_TIME = time(18, 0)
TIMEZONE = ZoneInfo("Europe/Paris")
RPES = ("7", "7.5", "8", "8.5", "9", "9.5")


@dataclass(frozen=True)
class Lift:
    """Exercice du programme : identifiant RepDB, charge de départ, pas de progression
    hebdomadaire (kg), séries et répétitions visées, échauffement ou non."""

    source_id: str
    start_kg: Decimal
    step_kg: Decimal
    sets: int
    reps: int
    warmup: bool = False


# Poussée, tirage, jambes : exercices courants de salle du catalogue RepDB (ADR 0006).
PROGRAM: tuple[tuple[Lift, ...], ...] = (
    (
        Lift("bench-press", Decimal(70), Decimal("2.5"), 4, 8, warmup=True),
        Lift("incline-db-press", Decimal(24), Decimal(1), 3, 10),
        Lift("seated-barbell-overhead-press", Decimal(45), Decimal("1.25"), 3, 8),
        Lift("cable-lateral-raise", Decimal(10), Decimal("1.25"), 3, 12),
        Lift("tricep-pushdown", Decimal(30), Decimal("1.25"), 3, 10),
    ),
    (
        Lift("deadlift", Decimal(120), Decimal(5), 3, 5, warmup=True),
        Lift("pull-up", Decimal(5), Decimal("1.25"), 4, 6),
        Lift("seated-cable-row", Decimal(55), Decimal("2.5"), 3, 10),
        Lift("straight-arm-pulldown", Decimal(25), Decimal("1.25"), 3, 12),
        Lift("ez-bar-curl", Decimal(30), Decimal("1.25"), 3, 10),
    ),
    (
        Lift("squat", Decimal(80), Decimal("2.5"), 4, 6, warmup=True),
        Lift("leg-press", Decimal(160), Decimal(5), 3, 10),
        Lift("walking-lunge", Decimal(20), Decimal(1), 3, 10),
        Lift("hip-thrust", Decimal(60), Decimal("2.5"), 3, 10),
        Lift("standing-calf-raise", Decimal(60), Decimal("2.5"), 4, 12),
    ),
)
SOURCE_IDS = tuple(lift.source_id for day in PROGRAM for lift in day)


PROGRAM_NAME = "Poussée / Tirage / Jambes"
DAY_NAMES = ("Poussée", "Tirage", "Jambes")


@dataclass(frozen=True)
class ProgramTarget:
    """Exercice d'une séance type du programme de démo, avec sa cible."""

    id: UUID
    source_id: str
    position: int
    target_sets: int
    target_reps: int


@dataclass(frozen=True)
class ProgramDayPlan:
    id: UUID
    name: str
    position: int
    exercises: tuple[ProgramTarget, ...]


def program() -> tuple[UUID, tuple[ProgramDayPlan, ...]]:
    """Programme de démo : les séances types du plan, avec les séries et répétitions visées."""
    return _id("programme"), tuple(
        ProgramDayPlan(
            id=_id("programme", index),
            name=DAY_NAMES[index],
            position=index,
            exercises=tuple(
                ProgramTarget(
                    id=_id("programme", index, position),
                    source_id=lift.source_id,
                    position=position,
                    target_sets=lift.sets,
                    target_reps=lift.reps,
                )
                for position, lift in enumerate(day)
            ),
        )
        for index, day in enumerate(PROGRAM)
    )


@dataclass(frozen=True)
class PlannedSet:
    id: UUID
    position: int
    weight_kg: Decimal
    reps: int
    rpe: Decimal | None
    is_warmup: bool
    performed_at: datetime


@dataclass(frozen=True)
class PlannedExercise:
    id: UUID
    source_id: str
    position: int
    sets: tuple[PlannedSet, ...]


@dataclass(frozen=True)
class PlannedWorkout:
    id: UUID
    started_at: datetime
    ended_at: datetime
    exercises: tuple[PlannedExercise, ...]


def _round(weight: Decimal, step: Decimal) -> Decimal:
    """Charge arrondie au pas de l'exercice (disques ou plaques disponibles)."""
    return (weight / step).quantize(Decimal(1)) * step


def plan(*, today: date) -> list[PlannedWorkout]:
    """Séances des `WEEKS` semaines précédant `today` (aucune dans le futur)."""
    monday = today - timedelta(days=today.weekday()) - timedelta(weeks=WEEKS)
    workouts: list[PlannedWorkout] = []
    for week in range(WEEKS):
        for index, weekday in enumerate(DAYS):
            day = monday + timedelta(weeks=week, days=weekday)
            if day >= today:
                continue
            started = datetime.combine(day, START_TIME, tzinfo=TIMEZONE)
            moment = started
            exercises: list[PlannedExercise] = []
            for position, lift in enumerate(PROGRAM[index]):
                # Progression d'un pas par semaine, avec une semaine de décharge à mi-parcours.
                load = lift.start_kg + lift.step_kg * (week - (1 if week >= 4 else 0))
                sets: list[PlannedSet] = []
                if lift.warmup:
                    moment += timedelta(minutes=3)
                    sets.append(
                        PlannedSet(
                            id=_id(week, index, position, "warmup"),
                            position=0,
                            weight_kg=_round(load / 2, lift.step_kg),
                            reps=lift.reps + 2,
                            rpe=None,
                            is_warmup=True,
                            performed_at=moment,
                        )
                    )
                for number in range(lift.sets):
                    key = (week, index, position, number)
                    moment += timedelta(minutes=2 + int(_draw("repos", *key) * 3))
                    # Fatigue en fin d'exercice, et une mauvaise série de temps en temps.
                    last = number == lift.sets - 1
                    missed = (last and _draw("fatigue", *key) < 0.4) or _draw("raté", *key) < 0.05
                    sets.append(
                        PlannedSet(
                            id=_id(week, index, position, number),
                            position=len(sets),
                            weight_kg=load,
                            reps=lift.reps - (1 + int(_draw("reps", *key) * 2) if missed else 0),
                            rpe=Decimal(RPES[int(_draw("rpe", *key) * len(RPES))]),
                            is_warmup=False,
                            performed_at=moment,
                        )
                    )
                exercises.append(
                    PlannedExercise(
                        id=_id(week, index, position),
                        source_id=lift.source_id,
                        position=position,
                        sets=tuple(sets),
                    )
                )
            workouts.append(
                PlannedWorkout(
                    id=_id(week, index),
                    started_at=started,
                    ended_at=moment + timedelta(minutes=5),
                    exercises=tuple(exercises),
                )
            )
    return workouts
