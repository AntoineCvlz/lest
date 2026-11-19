"""Exercices de cardio de Lest (ADR 0017) : un par sport de l'ancien catalogue des activités
(ADR 0012), sans propriétaire, visibles de tous. Écrits par la migration
`0006_lest_cardio_exercises` ; l'import RepDB ne les désactive jamais (préfixe `lest:`).

Les clés reprennent celles des sports : la recopie des activités en séances y retrouve son
exercice (`lest:<sport>`)."""

from dataclasses import dataclass

LEST_PREFIX = "lest:"


@dataclass(frozen=True)
class CardioExercise:
    key: str
    name: str
    # `distance_duration` (distance facultative) ou `duration`.
    kind: str

    @property
    def source_id(self) -> str:
        return f"{LEST_PREFIX}{self.key}"


CARDIO_EXERCISES: tuple[CardioExercise, ...] = (
    CardioExercise("running", "Course à pied", "distance_duration"),
    CardioExercise("cycling", "Vélo", "distance_duration"),
    CardioExercise("swimming", "Natation", "distance_duration"),
    CardioExercise("walking", "Marche", "distance_duration"),
    CardioExercise("hiking", "Randonnée", "distance_duration"),
    CardioExercise("rowing", "Aviron ou rameur", "distance_duration"),
    CardioExercise("cardio", "Cardio sur machine", "distance_duration"),
    CardioExercise("team_sport", "Sport collectif", "duration"),
    CardioExercise("racket", "Sport de raquette", "duration"),
    CardioExercise("combat", "Sport de combat", "duration"),
    CardioExercise("climbing", "Escalade", "duration"),
    CardioExercise("yoga", "Yoga ou mobilité", "duration"),
    CardioExercise("other", "Autre sport", "distance_duration"),
)
