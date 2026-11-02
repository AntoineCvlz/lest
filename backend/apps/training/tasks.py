import logging

from celery import shared_task
from django.conf import settings

from . import wger
from .services import import_wger_exercises, import_wger_images

logger = logging.getLogger(__name__)


@shared_task
def import_exercises() -> None:
    """Import mensuel du catalogue wger (`CELERY_BEAT_SCHEDULE`), puis de ses images (ADR 0005).
    Un échec du catalogue lève l'exception : la tâche apparaît en erreur, et le catalogue reste
    tel quel (transaction). Une image en échec est seulement comptée."""
    exercises = wger.fetch_exercises(settings.WGER_API_URL)
    report = import_wger_exercises(exercises=exercises)
    logger.info(
        "Catalogue wger : %d créés, %d mis à jour, %d désactivés, %d ignorés",
        report.created,
        report.updated,
        report.deactivated,
        report.skipped,
    )
    images = import_wger_images(
        exercises=exercises,
        fetch=lambda url: wger.fetch_image(url, base_url=settings.WGER_API_URL),
    )
    logger.info(
        "Images wger : %d importées, %d inchangées, %d retirées, %d en échec",
        images.imported,
        images.unchanged,
        images.removed,
        images.failed,
    )
