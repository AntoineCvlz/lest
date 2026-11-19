"""Ce que mesure une série selon le type de son exercice (ADR 0017).

Une seule table de séries à colonnes facultatives : ce module dit lesquelles sont attendues
pour chaque type, quels records en découlent et quelles séries comptent dans le volume.
"""

from .models import ExerciseKind, RecordKind, SetType

# Colonnes de mesure d'une série.
MEASURES = ("weight_kg", "reps", "duration_s", "distance_m")

# Colonnes exigées par type ; les autres doivent rester vides.
COLUMNS: dict[str, frozenset[str]] = {
    ExerciseKind.WEIGHT_REPS: frozenset({"weight_kg", "reps"}),
    ExerciseKind.REPS: frozenset({"reps"}),
    ExerciseKind.WEIGHTED_REPS: frozenset({"weight_kg", "reps"}),
    ExerciseKind.ASSISTED_REPS: frozenset({"weight_kg", "reps"}),
    ExerciseKind.DURATION: frozenset({"duration_s"}),
    ExerciseKind.DISTANCE_DURATION: frozenset({"distance_m", "duration_s"}),
    ExerciseKind.WEIGHT_DISTANCE: frozenset({"weight_kg", "distance_m"}),
}

# Séries de travail : tout sauf l'échauffement (volume, records, séries comptées).
WORKING_TYPES = frozenset({SetType.NORMAL, SetType.DROP, SetType.FAILURE})

# Records suivis par type. L'assistance d'une traction assistée n'est pas un record (moins
# d'assistance vaut mieux) : seules ses répétitions comptent.
RECORDS: dict[str, tuple[RecordKind, ...]] = {
    ExerciseKind.WEIGHT_REPS: (
        RecordKind.HEAVIEST,
        RecordKind.ESTIMATED_ONE_REP_MAX,
        RecordKind.SET_VOLUME,
    ),
    ExerciseKind.REPS: (RecordKind.MOST_REPS,),
    ExerciseKind.WEIGHTED_REPS: (RecordKind.HEAVIEST, RecordKind.SET_VOLUME),
    ExerciseKind.ASSISTED_REPS: (RecordKind.MOST_REPS,),
    ExerciseKind.DURATION: (RecordKind.LONGEST_DURATION,),
    ExerciseKind.DISTANCE_DURATION: (RecordKind.LONGEST_DISTANCE, RecordKind.LONGEST_DURATION),
    ExerciseKind.WEIGHT_DISTANCE: (RecordKind.HEAVIEST, RecordKind.LONGEST_DISTANCE),
}

# Types dont la charge fois les répétitions compte dans le volume (le lest seul pour un
# exercice lesté ; jamais l'assistance).
VOLUME_KINDS = frozenset({ExerciseKind.WEIGHT_REPS, ExerciseKind.WEIGHTED_REPS})
