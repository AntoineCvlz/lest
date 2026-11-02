import logging

from celery import shared_task
from django.conf import settings

from . import repdb
from .services import ImportRunningError, import_images, import_lock
from .services import import_exercises as import_catalog

logger = logging.getLogger(__name__)


@shared_task
def import_exercises() -> None:
    """Import mensuel du catalogue RepDB (`CELERY_BEAT_SCHEDULE`), puis de ses images
    (ADR 0006). Un échec du catalogue lève l'exception : la tâche apparaît en erreur, et le
    catalogue reste tel quel (transaction). Une image en échec est seulement comptée. Un import
    déjà en cours (commande lancée à la main) : la tâche passe son tour."""
    try:
        with import_lock():
            _import()
    except ImportRunningError:
        logger.warning("Import RepDB déjà en cours : tâche ignorée")


def _import() -> None:
    exercises = repdb.fetch_catalog(settings.REPDB_BASE_URL)
    report = import_catalog(exercises=exercises)
    logger.info(
        "Catalogue RepDB : %d créés, %d mis à jour, %d désactivés",
        report.created,
        report.updated,
        report.deactivated,
    )
    images = import_images(
        exercises=exercises,
        fetch=lambda path: repdb.fetch_image(path, base_url=settings.REPDB_BASE_URL),
    )
    logger.info(
        "Images RepDB : %d importées, %d inchangées, %d retirées, %d en échec",
        images.imported,
        images.unchanged,
        images.removed,
        images.failed,
    )
