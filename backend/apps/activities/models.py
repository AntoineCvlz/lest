"""Activités hors musculation (ADR 0012). Date et sport en clair (période, contrainte) ; durée,
distance, fréquence cardiaque, ressenti et métriques chiffrés au repos."""

import json
from typing import ClassVar

from django.conf import settings
from django.db import models

from apps.activities.sports import SPORTS
from common.fields import EncryptedDecimalField, EncryptedTextField

# Bornes vérifiées par le service : la base ne lit pas une valeur chiffrée.
MIN_DURATION_S = 60
MAX_DURATION_S = 24 * 3600
MAX_DISTANCE_M = 1_000_000
MIN_HEART_RATE = 30
MAX_HEART_RATE = 230
MIN_FEELING, MAX_FEELING = 1, 5
MAX_ACTIVITIES_PER_DAY = 20


class Activity(models.Model):
    """Une séance d'un sport du catalogue. Identifiant UUID du client (saisie rejouable hors
    ligne, ADR 0003) ; plusieurs par jour."""

    id = models.UUIDField(primary_key=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="activities"
    )
    date = models.DateField()
    sport = models.CharField(max_length=16)
    duration_s = EncryptedDecimalField(decimal_places=0)
    distance_m = EncryptedDecimalField(decimal_places=1, null=True)
    avg_heart_rate = EncryptedDecimalField(decimal_places=0, null=True)
    # 1 (très mauvais) à 5 (excellent).
    feeling = EncryptedDecimalField(decimal_places=0, null=True)
    # Métriques du sport (`sports.Metric`), en JSON : {"elevation_gain_m": 320}.
    metrics = EncryptedTextField(default="{}")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("date", "created_at")
        verbose_name_plural = "activities"
        indexes: ClassVar[list[models.Index]] = [
            models.Index(fields=("owner", "date"), name="activities_owner_date"),
        ]
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(sport__in=list(SPORTS)), name="activities_sport_valid"
            ),
        ]

    def __str__(self) -> str:
        # Jamais les valeurs : `__str__` finit dans les journaux.
        return f"Activité ({self.sport}) du {self.date.isoformat()}"

    def metric_values(self) -> dict[str, int]:
        """Métriques déchiffrées ; un contenu illisible compte comme aucune métrique."""
        try:
            raw = json.loads(self.metrics or "{}")
        except json.JSONDecodeError:
            return {}
        if not isinstance(raw, dict):
            return {}
        return {k: v for k, v in raw.items() if isinstance(k, str) and type(v) is int}
