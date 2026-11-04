"""Tâches de synchronisation Basic-Fit (ADR 0014) : chaque heure (`CELERY_BEAT_SCHEDULE`) pour
les comptes reliés, ou à la demande. Panne de Basic-Fit : nouvel essai avec délai croissant."""

from celery import shared_task
from django.conf import settings

from apps.accounts.models import User
from apps.integrations.basicfit import services


@shared_task(
    autoretry_for=(services.UnavailableError,),
    retry_backoff=60,
    retry_backoff_max=3600,
    retry_jitter=True,
    max_retries=4,
)
def sync_account(user_id: str) -> int:
    """Synchronise un compte ; renvoie le nombre de jours de visite relus (0 si rien à faire)."""
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if user is None:
        return 0
    try:
        return services.sync(owner=user).visits
    except (
        services.DisabledError,
        services.NotConnectedError,
        services.TooSoonError,
        services.SyncBusyError,
    ):
        return 0


@shared_task
def sync_due_accounts() -> int:
    """Met en file les comptes à synchroniser ; renvoie leur nombre."""
    if not settings.BASICFIT_ENABLED:
        return 0
    due = services.due_for_sync()
    for user_id in due:
        sync_account.delay(user_id)
    return len(due)
