import json
from argparse import ArgumentParser
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.training import repdb
from apps.training.services import (
    EmptyCatalogError,
    ImportRunningError,
    import_exercises,
    import_images,
    import_lock,
)


class Command(BaseCommand):
    help = (
        "Met à jour le catalogue d'exercices depuis RepDB (ADR 0006), puis ses images. "
        "Rejouable. --file : `exercises.json` local, sans appel réseau ni images. "
        "--no-images : catalogue seulement."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--file", type=Path)
        parser.add_argument("--no-images", action="store_true")

    def handle(self, *args: Any, file: Path | None, no_images: bool, **options: Any) -> None:
        try:
            with import_lock():
                self._import(file=file, no_images=no_images)
        except ImportRunningError as error:
            raise CommandError("Un import est déjà en cours : relancer plus tard.") from error

    def _import(self, *, file: Path | None, no_images: bool) -> None:
        try:
            if file is None:
                exercises = repdb.fetch_catalog(settings.REPDB_BASE_URL)
            else:
                exercises = repdb.parse_catalog(json.loads(file.read_text(encoding="utf-8")))
            report = import_exercises(exercises=exercises)
        except (repdb.RepdbError, EmptyCatalogError, OSError, json.JSONDecodeError) as error:
            raise CommandError(f"Import interrompu, catalogue inchangé : {error!r}") from error
        self.stdout.write(
            f"Exercices : {report.created} créés, {report.updated} mis à jour, "
            f"{report.deactivated} désactivés."
        )
        if file is not None or no_images:
            return
        images = import_images(exercises=exercises, fetch=_fetch_image)
        self.stdout.write(
            f"Images : {images.imported} importées, {images.unchanged} inchangées, "
            f"{images.removed} retirées, {images.failed} en échec."
        )


def _fetch_image(path: str) -> bytes:
    return repdb.fetch_image(path, base_url=settings.REPDB_BASE_URL)
