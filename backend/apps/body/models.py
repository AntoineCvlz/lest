"""Corps : pesées quotidiennes et mensurations (ADR 0007). Les valeurs sont chiffrées au repos,
seuls la date et l'endroit mesuré restent en clair (tri, unicité, période demandée)."""

from decimal import Decimal
from typing import ClassVar

from django.conf import settings
from django.db import models

from common.fields import EncryptedDecimalField

# Bornes vérifiées par le service : la base ne lit pas une valeur chiffrée.
MIN_WEIGHT_KG = 20
MAX_WEIGHT_KG = 400
# Décimaux : `Decimal("0.1") < 0.1` est vrai (le flottant 0,1 vaut un peu plus).
MIN_LENGTH_M = Decimal("0.1")
MAX_LENGTH_M = Decimal("2.5")


class Site(models.TextChoices):
    """Endroit mesuré au mètre ruban ; un seul côté pour les membres (toujours le même)."""

    NECK = "neck", "Cou"
    CHEST = "chest", "Poitrine"
    WAIST = "waist", "Taille"
    HIPS = "hips", "Hanches"
    ARM = "arm", "Bras"
    THIGH = "thigh", "Cuisse"
    CALF = "calf", "Mollet"


class BodyWeight(models.Model):
    """Une pesée par compte et par jour ; une nouvelle saisie du même jour la remplace."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="body_weights"
    )
    date = models.DateField()
    weight_kg = EncryptedDecimalField(decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("date",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(fields=("owner", "date"), name="body_weight_one_per_day"),
        ]

    def __str__(self) -> str:
        # Jamais la valeur : `__str__` finit dans les journaux et l'admin.
        return f"Pesée du {self.date.isoformat()}"


class BodyMeasurement(models.Model):
    """Une mensuration par compte, jour et endroit ; une nouvelle saisie la remplace."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="body_measurements"
    )
    date = models.DateField()
    site = models.CharField(max_length=16, choices=Site.choices)
    # Mètres, au millimètre (unités SI).
    length_m = EncryptedDecimalField(decimal_places=3)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("date", "site")
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(
                fields=("owner", "date", "site"), name="body_measurement_one_per_day_and_site"
            ),
            models.CheckConstraint(
                condition=models.Q(site__in=Site.values), name="body_measurement_site_valid"
            ),
        ]

    def __str__(self) -> str:
        # Jamais la valeur : `__str__` finit dans les journaux et l'admin.
        return f"Mensuration ({self.site}) du {self.date.isoformat()}"
