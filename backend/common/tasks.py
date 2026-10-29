from allauth.usersessions.models import UserSession
from celery import shared_task
from django.contrib.sessions.models import Session
from django.core.management import call_command


@shared_task
def ping() -> str:
    """Tâche témoin : vérifie que le worker consomme bien la file."""
    return "pong"


@shared_task
def clear_expired_sessions() -> None:
    """Supprime les sessions expirées, que Django ne retire jamais seul : parcours de connexion
    abandonnés, défis de passkey (sessions de 5 minutes), sessions révoquées. Puis les fiches
    d'appareil (IP, navigateur) des sessions disparues : allauth ne les retire qu'à la connexion
    suivante, elles resteraient sinon jusqu'à la suppression du compte."""
    call_command("clearsessions")
    UserSession.objects.exclude(session_key__in=Session.objects.values("session_key")).delete()
