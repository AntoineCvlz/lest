import logging

from celery import shared_task
from django.conf import settings

from . import ciqual
from .services import ImportRunningError, import_lock
from .services import import_foods as import_table

logger = logging.getLogger(__name__)


@shared_task
def import_foods() -> None:
    """Import mensuel de la table Ciqual (`CELERY_BEAT_SCHEDULE`, ADR 0009). Un échec lève
    l'exception : la tâche apparaît en erreur, et les aliments restent tels quels (transaction).
    Un import déjà en cours (commande lancée à la main) : la tâche passe son tour."""
    try:
        with import_lock():
            files = settings.CIQUAL_FILES
            foods = ciqual.parse_foods(
                ciqual.fetch_file(settings.CIQUAL_BASE_URL, files["alim"]),
                ciqual.fetch_file(settings.CIQUAL_BASE_URL, files["compo"]),
            )
            report = import_table(foods=foods)
            logger.info(
                "Ciqual : %d créés, %d mis à jour, %d désactivés",
                report.created,
                report.updated,
                report.deactivated,
            )
    except ImportRunningError:
        logger.warning("Import Ciqual déjà en cours : tâche ignorée")
