import logging

from celery import shared_task
from django.conf import settings

from . import wger
from .services import import_wger_exercises

logger = logging.getLogger(__name__)


@shared_task
def import_exercises() -> None:
    """Import mensuel du catalogue wger (`CELERY_BEAT_SCHEDULE`). Un échec lève l'exception :
    la tâche apparaît en erreur, et le catalogue reste tel quel (transaction)."""
    report = import_wger_exercises(exercises=wger.fetch_exercises(settings.WGER_API_URL))
    logger.info(
        "Catalogue wger : %d créés, %d mis à jour, %d désactivés, %d ignorés",
        report.created,
        report.updated,
        report.deactivated,
        report.skipped,
    )
