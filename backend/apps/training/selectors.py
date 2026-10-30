from decimal import Decimal
from typing import Any
from uuid import UUID

from django.db.models import Prefetch, Q

from apps.accounts.models import User
from common.pagination import Page, paginate

from .models import Equipment, Exercise, Muscle, PersonalRecord, Set, Workout, WorkoutExercise

# Recherche : quelques mots, chacun présent dans le nom (sans accents ni casse).
MAX_SEARCH_TERMS = 5


def search_exercises(
    *,
    query: str = "",
    category: str | None = None,
    muscle_id: int | None = None,
    equipment_id: int | None = None,
    cursor: str | None = None,
    limit: int,
) -> Page[Exercise]:
    """Exercices actifs du catalogue (commun à tous les comptes), par ordre alphabétique.

    Un muscle filtre sur les muscles principaux et secondaires. Lève `InvalidCursorError`.
    """
    exercises = Exercise.objects.filter(is_active=True)
    for term in query.split()[:MAX_SEARCH_TERMS]:
        exercises = exercises.filter(name__unaccent__icontains=term)
    if category is not None:
        exercises = exercises.filter(category=category)
    if muscle_id is not None:
        exercises = exercises.filter(
            Q(muscles__id=muscle_id) | Q(secondary_muscles__id=muscle_id)
        ).distinct()
    if equipment_id is not None:
        exercises = exercises.filter(equipment__id=equipment_id)
    return paginate(
        exercises.prefetch_related("muscles", "equipment"),
        keys=("name", "id"),
        cursor=cursor,
        limit=limit,
    )


def get_exercise(*, exercise_id: UUID) -> Exercise | None:
    """Exercice du catalogue, même retiré de wger (il reste lisible depuis l'historique)."""
    return (
        Exercise.objects.filter(pk=exercise_id)
        .prefetch_related("muscles", "secondary_muscles", "equipment")
        .first()
    )


def exercise_filters() -> tuple[list[Muscle], list[Equipment]]:
    """Muscles et équipements utilisés par au moins un exercice actif (valeurs des filtres)."""
    muscles = Muscle.objects.filter(
        Q(primary_exercises__is_active=True) | Q(secondary_exercises__is_active=True)
    ).distinct()
    equipment = Equipment.objects.filter(exercises__is_active=True).distinct()
    return list(muscles), list(equipment)


def get_workout(*, owner: User, workout_id: UUID) -> Workout | None:
    """Séance de `owner` avec ses exercices et séries, ou `None` (absente ou d'un autre compte)."""
    return (
        Workout.objects.filter(pk=workout_id, owner=owner)
        .prefetch_related(
            Prefetch(
                "exercises",
                queryset=WorkoutExercise.objects.select_related("exercise").prefetch_related(
                    "sets__records"
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


# Historique borné : les plus récents seulement (pagination par curseur avec l'écran).
MAX_HISTORY = 200


def records_history(*, owner: User, exercise_id: UUID) -> list[PersonalRecord]:
    """Records successifs de `owner` pour un exercice, du plus ancien au plus récent (les
    `MAX_HISTORY` derniers)."""
    latest = PersonalRecord.objects.filter(owner=owner, exercise_id=exercise_id).order_by(
        "-achieved_at", "-kind"
    )[:MAX_HISTORY]
    return list(reversed(latest))


def export_records(*, owner: User) -> list[dict[str, Any]]:
    """Records de `owner` pour l'export RGPD (dérivés de ses séries)."""
    return [
        {
            "exercise": record.exercise.name,
            "kind": record.kind,
            "value_kg": float(record.value_kg),
            "achieved_at": record.achieved_at.isoformat(),
        }
        for record in PersonalRecord.objects.filter(owner=owner).select_related("exercise")
    ]


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
