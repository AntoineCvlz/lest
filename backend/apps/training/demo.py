"""Séances de démonstration (dev seulement) : 8 semaines réalistes pour le compte démo.

Plan déterministe (même graine, mêmes identifiants) : relancer le seed remplace les séances au
lieu de les dupliquer, grâce aux écritures idempotentes (ADR 0003). Les charges progressent
d'une semaine à l'autre, avec quelques séances moins bonnes, comme un vrai carnet.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid5
from zoneinfo import ZoneInfo

WEEKS = 8
# Lundi, mercredi, vendredi à 18 h, heure de Paris.
DAYS = (0, 2, 4)
START_TIME = time(18, 0)
TIMEZONE = ZoneInfo("Europe/Paris")
RPES = ("7", "7.5", "8", "8.5", "9", "9.5")
NAMESPACE = uuid5(NAMESPACE_URL, "https://lest.local/demo")


@dataclass(frozen=True)
class Lift:
    """Exercice du programme : nom exact dans le catalogue, charge de départ, pas de progression
    hebdomadaire (kg), séries et répétitions visées, échauffement ou non."""

    name: str
    start_kg: Decimal
    step_kg: Decimal
    sets: int
    reps: int
    warmup: bool = False


# Poussée, tirage, jambes : exercices courants de salle, illustrés dans le catalogue wger.
PROGRAM: tuple[tuple[Lift, ...], ...] = (
    (
        Lift("Développé couché", Decimal(70), Decimal("2.5"), 4, 8, warmup=True),
        Lift("Développé incliné - haltères", Decimal(24), Decimal(1), 3, 10),
        Lift("Développé militaire à la barre", Decimal(45), Decimal("1.25"), 3, 8),
        Lift("Élévation latérale à la machine", Decimal(30), Decimal("1.25"), 3, 12),
        Lift("Extension des triceps à la barre", Decimal(30), Decimal("1.25"), 3, 10),
    ),
    (
        Lift("Soulevé de terre au rack", Decimal(120), Decimal(5), 3, 5, warmup=True),
        Lift("Tractions", Decimal(5), Decimal("1.25"), 4, 6),
        Lift("Rowing assis à la poulie", Decimal(55), Decimal("2.5"), 3, 10),
        Lift("Tirage bras tendus (poulie)", Decimal(25), Decimal("1.25"), 3, 12),
        Lift("Curl biceps avec barre SZ", Decimal(30), Decimal("1.25"), 3, 10),
    ),
    (
        Lift("Front Squats", Decimal(70), Decimal("2.5"), 4, 6, warmup=True),
        Lift("Presse à cuisses", Decimal(160), Decimal(5), 3, 10),
        Lift("Fentes", Decimal(20), Decimal(1), 3, 10),
        Lift("Hip Thrust avec haltère", Decimal(40), Decimal("2.5"), 3, 10),
        Lift("Extension des mollets debout", Decimal(60), Decimal("2.5"), 4, 12),
    ),
)
EXERCISE_NAMES = tuple(lift.name for day in PROGRAM for lift in day)


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
    name: str
    position: int
    sets: tuple[PlannedSet, ...]


@dataclass(frozen=True)
class PlannedWorkout:
    id: UUID
    started_at: datetime
    ended_at: datetime
    exercises: tuple[PlannedExercise, ...]


def _id(*parts: object) -> UUID:
    return uuid5(NAMESPACE, "/".join(str(part) for part in parts))


def _draw(*parts: object) -> float:
    """Tirage déterministe dans [0, 1) : même entrée, même valeur, d'un seed à l'autre."""
    return _id("tirage", *parts).int / 2**128


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
                        name=lift.name,
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
