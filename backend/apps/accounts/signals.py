from typing import Any

from allauth.account.internal.stagekit import clear_login
from allauth.account.signals import password_reset
from allauth.core import ratelimit
from allauth.mfa.signals import authentication_failed
from django.core.cache import cache
from django.dispatch import receiver

from .adapter import DAILY_FAILURES
from .services import send_account_mail

# Au plus une alerte par heure et par compte : un attaquant ne doit pas pouvoir inonder la boîte.
MFA_FAILURE_ALERT_INTERVAL = 60 * 60


@receiver(authentication_failed)
def on_failed_second_factor(sender: Any, request: Any, user: Any, **kwargs: Any) -> None:
    """Code de vérification refusé à la connexion : plafond journalier et alerte au titulaire.

    allauth n'offre pas de point d'arrêt avant la validation du code : au plafond atteint, la
    connexion en attente est annulée, et la reprendre repasse par le mot de passe, bloqué par
    `AccountAdapter.pre_authenticate`. L'alerte (ASVS V2.2.3) signale qu'un tiers connaît
    probablement le mot de passe ; une par heure au plus.
    """
    if kwargs.get("reauthentication"):
        return  # session déjà ouverte : une faute de frappe, pas une intrusion
    key = user.email.lower()
    ratelimit.consume(request, action=DAILY_FAILURES, key=key)
    if not ratelimit.consume(request, action=DAILY_FAILURES, key=key, dry_run=True):
        clear_login(request)  # plafond atteint par cet échec : plus aucun essai sur cette connexion
    if cache.add(f"accounts:mfa-failure-alert:{user.pk}", 1, MFA_FAILURE_ALERT_INTERVAL):
        send_account_mail("account/email/mfa_failed", user.email)


@receiver(password_reset)
def clear_daily_failures_on_password_reset(
    sender: Any, request: Any, user: Any, **kwargs: Any
) -> None:
    """Le titulaire a repris la main (code reçu par e-mail) : le plafond journalier est levé."""
    ratelimit.clear(request, action=DAILY_FAILURES, key=user.email.lower())
