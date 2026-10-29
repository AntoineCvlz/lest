from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db.models import Prefetch

from apps.accounts.models import User

from .models import Set, Workout, WorkoutExercise


def get_workout(*, owner: User, workout_id: UUID) -> Workout | None:
    """Séance de `owner` avec ses exercices et séries, ou `None` (absente ou d'un autre compte)."""
    return (
        Workout.objects.filter(pk=workout_id, owner=owner)
        .prefetch_related(
            Prefetch(
                "exercises",
                queryset=WorkoutExercise.objects.select_related("exercise").prefetch_related(
                    "sets"
                ),
            )
        )
        .first()
    )


def working_sets(sets: list[Set]) -> list[Set]:
    """Séries de travail : l'échauffement ne compte ni dans le volume ni dans les records."""
    return [one for one in sets if not one.is_warmup]


def workout_volume_kg(workout: Workout) -> Decimal:
    """Volume : somme de poids * reps des séries de travail (CLAUDE.md). Recalculé à chaque
    lecture : une série modifiée ou rejouée donne le même résultat (ADR 0003)."""
    return sum(
        (
            one.weight_kg * one.reps
            for exercise in workout.exercises.all()
            for one in working_sets(list(exercise.sets.all()))
        ),
        Decimal(0),
    )


def export_workouts(*, owner: User) -> list[dict[str, Any]]:
    """Séances de `owner` pour l'export RGPD : dates, exercices (nom du catalogue) et séries,
    sans identifiants internes."""
    workouts = Workout.objects.filter(owner=owner).prefetch_related(
        Prefetch(
            "exercises",
            queryset=WorkoutExercise.objects.select_related("exercise").prefetch_related("sets"),
        )
    )
    return [
        {
            "started_at": workout.started_at.isoformat(),
            "ended_at": workout.ended_at.isoformat() if workout.ended_at else None,
            "exercises": [
                {
                    "exercise": item.exercise.name,
                    "sets": [
                        {
                            "weight_kg": float(one.weight_kg),
                            "reps": one.reps,
                            "rpe": float(one.rpe) if one.rpe is not None else None,
                            "is_warmup": one.is_warmup,
                            "performed_at": one.performed_at.isoformat(),
                        }
                        for one in item.sets.all()
                    ],
                }
                for item in workout.exercises.all()
            ],
        }
        for workout in workouts.order_by("started_at")
    ]
