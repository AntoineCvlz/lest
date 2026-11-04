"""Nutrition : aliments (ADR 0009). Ciqual (Anses) importée en local pour la recherche, produits
Open Food Facts gardés au scan d'un code-barres, aliments perso propres à chaque compte.

La composition d'un aliment n'est pas une donnée personnelle : elle reste en clair. Le journal
des repas, lui, est chiffré (ADR 0010) : seuls la date et le repas restent en clair.
"""

from typing import ClassVar
from uuid import uuid4

from django.conf import settings
from django.db import models

from common.fields import EncryptedDecimalField, EncryptedTextField

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


MAX_ENTRY_GRAMS = 5000
MAX_ENTRIES_PER_DAY = 100
MAX_WATER_ML = 10000


class Meal(models.TextChoices):
    BREAKFAST = "breakfast", "Petit-déjeuner"
    LUNCH = "lunch", "Déjeuner"
    DINNER = "dinner", "Dîner"
    SNACK = "snack", "Collation"


class JournalEntry(models.Model):
    """Aliment mangé (ADR 0010). Identifiant UUID du client (saisie rejouable hors ligne, ADR
    0003). L'aliment est **recopié** à la saisie (nom et valeurs pour 100 g) : l'historique ne
    bouge pas si l'aliment change ou disparaît. Tout est chiffré, sauf la date et le repas."""

    id = models.UUIDField(primary_key=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="journal_entries"
    )
    date = models.DateField()
    meal = models.CharField(max_length=12, choices=Meal.choices)
    # Référence de l'aliment d'origine (« aliments récents »), chiffrée : pas de clé étrangère.
    food_ref = EncryptedTextField()
    name = EncryptedTextField()
    grams = EncryptedDecimalField(decimal_places=1)
    kcal_100g = EncryptedDecimalField(decimal_places=1)
    protein_100g = EncryptedDecimalField(decimal_places=1, null=True)
    carbs_100g = EncryptedDecimalField(decimal_places=1, null=True)
    fat_100g = EncryptedDecimalField(decimal_places=1, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("date", "created_at")
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=("owner", "date"), name="nutrition_entry_owner_date"),
        ]
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(meal__in=Meal.values), name="nutrition_entry_meal_valid"
            ),
        ]

    def __str__(self) -> str:
        # Jamais l'aliment ni la quantité : `__str__` finit dans les journaux.
        return f"Entrée ({self.meal}) du {self.date.isoformat()}"


class WaterIntake(models.Model):
    """Eau bue dans la journée, un total par compte et par jour (chiffré)."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="water_intakes"
    )
    date = models.DateField()
    ml = EncryptedDecimalField(decimal_places=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("date",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(fields=("owner", "date"), name="nutrition_water_one_per_day"),
        ]

    def __str__(self) -> str:
        return f"Eau du {self.date.isoformat()}"


class TargetSex(models.TextChoices):
    """Sexe retenu pour la formule de Mifflin-St Jeor (seule donnée qu'elle demande)."""

    MALE = "male", "Formule masculine"
    FEMALE = "female", "Formule féminine"


class Activity(models.TextChoices):
    SEDENTARY = "sedentary", "Sédentaire"
    LIGHT = "light", "Peu actif"
    MODERATE = "moderate", "Actif"
    ACTIVE = "active", "Très actif"
    VERY_ACTIVE = "very_active", "Extrêmement actif"


class NutritionTarget(models.Model):
    """Objectifs nutritionnels d'un compte (ADR 0011) : données du calcul et objectifs saisis à
    la main, tous chiffrés. Créé seulement quand l'utilisateur active ses objectifs."""

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="nutrition_target"
    )
    sex = EncryptedTextField()
    # Date ISO (`AAAA-MM-JJ`), chiffrée comme texte.
    birth_date = EncryptedTextField()
    activity = EncryptedTextField()
    # Objectifs saisis à la main ; `None` : la valeur calculée s'applique.
    kcal = EncryptedDecimalField(decimal_places=0, null=True)
    protein_g = EncryptedDecimalField(decimal_places=0, null=True)
    carbs_g = EncryptedDecimalField(decimal_places=0, null=True)
    fat_g = EncryptedDecimalField(decimal_places=0, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return "Objectifs nutritionnels"
