"""Fichiers des photos effacés avec leur ligne (ADR 0008) : suppression directe, ou en cascade
avec le compte. Après validation seulement : une transaction annulée garde ses fichiers."""

from typing import Any

from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.body import photos
from apps.body.models import ProgressPhoto


@receiver(post_delete, sender=ProgressPhoto)
def remove_photo_files(sender: type[ProgressPhoto], instance: ProgressPhoto, **kwargs: Any) -> None:
    key = instance.file_key
    transaction.on_commit(lambda: photos.remove(key))
