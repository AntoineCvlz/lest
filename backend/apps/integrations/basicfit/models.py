"""Liaison d'un compte Lest à son compte Basic-Fit (ADR 0014). Jetons et vérificateur PKCE
chiffrés au repos ; jamais exportés ni journalisés."""

from typing import ClassVar

from django.conf import settings
from django.db import models

from common.fields import EncryptedTextField


class PendingLogin(models.Model):
    """Connexion commencée : `state` et vérificateur PKCE, une par compte, 10 minutes."""

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="basicfit_pending"
    )
    state = EncryptedTextField()
    verifier = EncryptedTextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return "Connexion Basic-Fit en cours"


class Connection(models.Model):
    """Compte Basic-Fit relié : jeu de jetons (JSON chiffré), état de la dernière synchro."""

    class Status(models.TextChoices):
        CONNECTED = "connected", "Relié"
        # Basic-Fit a refusé les jetons : l'utilisateur doit se reconnecter.
        EXPIRED = "expired", "Reconnexion nécessaire"

    owner = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="basicfit_connection"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.CONNECTED)
    tokens = EncryptedTextField()
    connected_at = models.DateTimeField(auto_now_add=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    # Code interne de la dernière erreur (jamais le message de Basic-Fit).
    last_error = models.CharField(max_length=20, blank=True)
    # Dernière tentative, réussie ou non : le plafond d'une synchro par heure porte sur elle.
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    # Refus de jetons consécutifs : le paquet ne distingue pas un refus d'une panne du serveur
    # de jetons (toute réponse autre que 200) ; les jetons ne sont effacés qu'au troisième.
    auth_failures = models.PositiveSmallIntegerField(default=0)
    # Change à chaque connexion : une synchro en cours n'écrase jamais des jetons plus récents.
    generation = models.PositiveIntegerField(default=0)
    # Nom du club principal (seul élément gardé du profil membre), chiffré.
    home_club = EncryptedTextField(blank=True, default="")

    def __str__(self) -> str:
        # Jamais les jetons : `__str__` finit dans les journaux.
        return f"Connexion Basic-Fit ({self.status})"


class Visit(models.Model):
    """Passage en club relevé par Basic-Fit : un par compte et par jour (calendrier
    d'assiduité). Le club est chiffré (lieu fréquenté) ; la date reste en clair (période)."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="basicfit_visits"
    )
    date = models.DateField()
    club = EncryptedTextField(blank=True, default="")

    class Meta:
        ordering = ("date",)
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.UniqueConstraint(fields=("owner", "date"), name="basicfit_visit_one_per_day"),
        ]

    def __str__(self) -> str:
        return f"Visite du {self.date.isoformat()}"
