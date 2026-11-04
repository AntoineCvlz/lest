"""Liaison d'un compte Lest à son compte Basic-Fit (ADR 0014). Jetons et vérificateur PKCE
chiffrés au repos ; jamais exportés ni journalisés."""

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

    def __str__(self) -> str:
        # Jamais les jetons : `__str__` finit dans les journaux.
        return f"Connexion Basic-Fit ({self.status})"
