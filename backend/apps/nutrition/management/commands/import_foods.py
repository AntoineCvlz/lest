from argparse import ArgumentParser
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.nutrition import ciqual
from apps.nutrition.services import (
    EmptyTableError,
    ImportRunningError,
    import_foods,
    import_lock,
)


class Command(BaseCommand):
    help = (
        "Met à jour les aliments depuis la table Ciqual de l'Anses (ADR 0009). Rejouable. "
        "--alim et --compo : fichiers XML locaux, sans appel réseau."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--alim", type=Path)
        parser.add_argument("--compo", type=Path)

    def handle(self, *args: Any, alim: Path | None, compo: Path | None, **options: Any) -> None:
        if (alim is None) != (compo is None):
            raise CommandError("--alim et --compo vont ensemble.")
        try:
            with import_lock():
                self._import(alim=alim, compo=compo)
        except ImportRunningError as error:
            raise CommandError("Un import est déjà en cours : relancer plus tard.") from error

    def _import(self, *, alim: Path | None, compo: Path | None) -> None:
        try:
            if alim is None or compo is None:
                files = settings.CIQUAL_FILES
                alim_data = ciqual.fetch_file(settings.CIQUAL_BASE_URL, files["alim"])
                compo_data = ciqual.fetch_file(settings.CIQUAL_BASE_URL, files["compo"])
            else:
                alim_data, compo_data = alim.read_bytes(), compo.read_bytes()
            report = import_foods(foods=ciqual.parse_foods(alim_data, compo_data))
        except (ciqual.CiqualError, EmptyTableError, OSError) as error:
            raise CommandError(f"Import interrompu, aliments inchangés : {error!r}") from error
        self.stdout.write(
            f"Aliments Ciqual : {report.created} créés, {report.updated} mis à jour, "
            f"{report.deactivated} désactivés."
        )
