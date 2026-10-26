from celery import shared_task


@shared_task
def ping() -> str:
    """Tâche témoin : vérifie que le worker consomme bien la file."""
    return "pong"
