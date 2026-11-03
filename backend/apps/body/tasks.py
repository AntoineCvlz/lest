"""Tâches de fond du domaine `body`."""

import time

from celery import shared_task

from apps.body import photos
from apps.body.models import ProgressPhoto

# Un envoi en cours écrit ses fichiers avant sa ligne : on lui laisse une heure.
ORPHAN_AGE_SECONDS = 3600


@shared_task
def clear_orphan_photos() -> int:
    """Efface les fichiers de photos sans ligne en base (envoi ou suppression interrompus) ;
    renvoie leur nombre. Chaque nuit (`CELERY_BEAT_SCHEDULE`)."""
    known = set(ProgressPhoto.objects.values_list("file_key", flat=True))
    cutoff = time.time() - ORPHAN_AGE_SECONDS
    orphans = [
        key for key, modified in photos.stored_keys() if key not in known and modified < cutoff
    ]
    for key in orphans:
        photos.remove(key)
    return len(orphans)
