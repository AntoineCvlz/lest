"""Musculation : catalogue d'exercices (importé de wger, ADR 0004), séances et séries.

Le catalogue est commun à tous les comptes ; séances et séries sont propres à chacun.
"""

from typing import ClassVar
from uuid import uuid4

from django.conf import settings
from django.db import models


class Category(models.TextChoices):
    ABS = "abs", "Abdominaux"
    ARMS = "arms", "Bras"
    BACK = "back", "Dos"
    CALVES = "calves", "Mollets"
    CARDIO = "cardio", "Cardio"
    CHEST = "chest", "Pectoraux"
    LEGS = "legs", "Jambes"
    SHOULDERS = "shoulders", "Épaules"


class NameLanguage(models.TextChoices):
    """Langue du nom affiché : wger n'a pas de nom français pour un tiers des exercices."""

    FRENCH = "fr", "Français"
    ENGLISH = "en", "Anglais"


class Muscle(models.Model):
    wger_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=60)
    is_front = models.BooleanField()

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Equipment(models.Model):
    """Équipement : ceux de wger, puis les machines de salle ajoutées par Lest (sans `wger_id`)."""

    wger_id = models.PositiveIntegerField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=60, unique=True)

    class Meta:
        ordering = ("name",)
        verbose_name_plural = "equipment"

    def __str__(self) -> str:
        return self.name


class Exercise(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    # Identifiant stable de wger : clé de l'import, qui le rend rejouable sans doublon.
    wger_uuid = models.UUIDField(unique=True, null=True, blank=True)
    name = models.CharField(max_length=200)
    name_language = models.CharField(max_length=2, choices=NameLanguage)
    category = models.CharField(max_length=20, choices=Category)
    muscles = models.ManyToManyField(Muscle, related_name="primary_exercises", blank=True)
    secondary_muscles = models.ManyToManyField(
        Muscle, related_name="secondary_exercises", blank=True
    )
    equipment = models.ManyToManyField(Equipment, related_name="exercises", blank=True)
    # Attribution (CC-BY-SA, ADR 0004) : licence et auteur tels que fournis par wger.
    license = models.CharField(max_length=20)
    license_author = models.CharField(max_length=200, blank=True)
    # Retiré de wger : gardé pour l'historique des séances, masqué de la recherche.
    is_active = models.BooleanField(default=True)
    source_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(name_language__in=NameLanguage.values),
                name="training_exercise_name_language_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(category__in=Category.values),
                name="training_exercise_category_valid",
            ),
            models.CheckConstraint(
                condition=~models.Q(name=""), name="training_exercise_name_not_empty"
            ),
        ]

    def __str__(self) -> str:
        return self.name


# --- Séances (propres à chaque compte) ------------------------------------------------------
# Identifiants générés par le client et écritures par `PUT` (ADR 0003) : `id` n'a pas de
# valeur par défaut, le client la fournit toujours. Charges en kilogrammes (unités SI).

MAX_WEIGHT_KG = 1000
MAX_REPS = 1000


class Workout(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workouts"
    )
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-started_at",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(ended_at__isnull=True)
                | models.Q(ended_at__gte=models.F("started_at")),
                name="training_workout_ends_after_start",
            ),
        ]

    # Identifiant seul : ni dates ni charges dans les journaux et l'admin (minimisation).
    def __str__(self) -> str:
        return f"Séance {self.pk}"


class WorkoutExercise(models.Model):
    """Exercice d'une séance, à sa place dans l'ordre de la séance."""

    id = models.UUIDField(primary_key=True, editable=False)
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name="exercises")
    # PROTECT : un exercice utilisé n'est jamais supprimé du catalogue (désactivé, ADR 0004).
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="+")
    position = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "created_at")

    def __str__(self) -> str:
        return f"Exercice de séance {self.pk}"


class Set(models.Model):
    id = models.UUIDField(primary_key=True, editable=False)
    workout_exercise = models.ForeignKey(
        WorkoutExercise, on_delete=models.CASCADE, related_name="sets"
    )
    position = models.PositiveSmallIntegerField()
    weight_kg = models.DecimalField(max_digits=6, decimal_places=2)
    reps = models.PositiveSmallIntegerField()
    # Effort perçu (1 à 10, par demi-points), facultatif.
    rpe = models.DecimalField(max_digits=3, decimal_places=1, null=True, blank=True)
    is_warmup = models.BooleanField(default=False)
    # Heure réelle de la série, fournie par le client (hors ligne compris, ADR 0003).
    performed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("position", "performed_at")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(weight_kg__gte=0, weight_kg__lte=MAX_WEIGHT_KG),
                name="training_set_weight_range",
            ),
            models.CheckConstraint(
                condition=models.Q(reps__lte=MAX_REPS), name="training_set_reps_range"
            ),
            models.CheckConstraint(
                condition=models.Q(rpe__isnull=True) | models.Q(rpe__gte=1, rpe__lte=10),
                name="training_set_rpe_range",
            ),
        ]

    def __str__(self) -> str:
        return f"Série {self.pk}"
