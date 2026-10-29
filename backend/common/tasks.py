from celery import shared_task
from django.core.management import call_command


@shared_task
def ping() -> str:
    """Tâche témoin : vérifie que le worker consomme bien la file."""
    return "pong"


@shared_task
def clear_expired_sessions() -> None:
    """Supprime les sessions expirées, que Django ne retire jamais seul : parcours de connexion
    abandonnés, défis de passkey (sessions de 5 minutes), sessions révoquées."""
    call_command("clearsessions")
