"""Catalogue d'exercices (importé de wger, ADR 0004) : exercices, muscles et équipements.

Le catalogue est commun à tous les comptes. Les séances, séries et records (propres à chaque
compte) arrivent dans les PR suivantes.
"""

from typing import ClassVar
from uuid import uuid4

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
