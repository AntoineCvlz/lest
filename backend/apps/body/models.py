"""Corps : pesées quotidiennes (ADR 0007). Les valeurs sont chiffrées au repos, seule la date
reste en clair (tri, unicité, période demandée)."""

from typing import ClassVar

from django.conf import settings
from django.db import models

from common.fields import EncryptedDecimalField

# Bornes vérifiées par le service : la base ne lit pas une valeur chiffrée.
MIN_WEIGHT_KG = 20
MAX_WEIGHT_KG = 400


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
