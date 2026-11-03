"""Nutrition : aliments (ADR 0009). Ciqual (Anses) importée en local pour la recherche, produits
Open Food Facts gardés au scan d'un code-barres, aliments perso propres à chaque compte.

La composition d'un aliment n'est pas une donnée personnelle : elle reste en clair. Le journal
des repas, lui, en est une (PR suivante).
"""

from typing import ClassVar
from uuid import uuid4

from django.conf import settings
from django.db import models

# Valeurs pour 100 g : au-delà, une erreur de saisie ou de source (l'huile fait 900 kcal).
MAX_KCAL_100G = 900
MAX_GRAMS_100G = 100


class FoodSource(models.TextChoices):
    CIQUAL = "ciqual", "Table Ciqual (Anses)"
    OFF = "off", "Open Food Facts"
    CUSTOM = "custom", "Aliment perso"


class Food(models.Model):
    """Aliment et sa composition pour 100 g. `owner` n'est renseigné que pour un aliment perso ;
    Ciqual et Open Food Facts sont communs à tous les comptes."""

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    source = models.CharField(max_length=8, choices=FoodSource.choices)
    # Code Ciqual (`alim_code`) ou code-barres ; vide pour un aliment perso.
    source_code = models.CharField(max_length=32, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="custom_foods",
    )
    name = models.CharField(max_length=200)
    brand = models.CharField(max_length=120, blank=True)
    kcal_100g = models.DecimalField(max_digits=4, decimal_places=1)
    # Inconnues (`None`) quand la source ne les donne pas ; comptées 0 dans les totaux.
    protein_100g = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    carbs_100g = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    fat_100g = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    # Portion indiquée par la source (Open Food Facts) ou l'utilisateur, en grammes.
    serving_g = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    # Retiré d'une nouvelle version de Ciqual : introuvable, mais lisible depuis le journal.
    is_active = models.BooleanField(default=True)
    fetched_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(
                fields=("source", "source_code"),
                condition=models.Q(owner__isnull=True),
                name="nutrition_food_source_code_unique",
            ),
            models.CheckConstraint(
                condition=models.Q(source__in=FoodSource.values),
                name="nutrition_food_source_valid",
            ),
            # Un aliment perso a un propriétaire, et lui seul en a un.
            models.CheckConstraint(
                condition=(
                    models.Q(source=FoodSource.CUSTOM, owner__isnull=False)
                    | (~models.Q(source=FoodSource.CUSTOM) & models.Q(owner__isnull=True))
                ),
                name="nutrition_food_owner_iff_custom",
            ),
            models.CheckConstraint(
                condition=models.Q(kcal_100g__gte=0, kcal_100g__lte=MAX_KCAL_100G),
                name="nutrition_food_kcal_range",
            ),
            *(
                models.CheckConstraint(
                    condition=models.Q(**{f"{field}__isnull": True})
                    | models.Q(**{f"{field}__gte": 0, f"{field}__lte": MAX_GRAMS_100G}),
                    name=f"nutrition_food_{field}_range",
                )
                for field in ("protein_100g", "carbs_100g", "fat_100g")
            ),
        ]

    def __str__(self) -> str:
        return self.name
