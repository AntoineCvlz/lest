import json
from argparse import ArgumentParser
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.training import wger
from apps.training.services import EmptyCatalogError, import_wger_exercises


class Command(BaseCommand):
    help = (
        "Met à jour le catalogue d'exercices depuis wger (ADR 0004). Rejouable. "
        "--file : pages `exerciseinfo` enregistrées (liste JSON), sans appel réseau."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--file", type=Path)

    def handle(self, *args: Any, file: Path | None, **options: Any) -> None:
        try:
            if file is None:
                exercises = wger.fetch_exercises(settings.WGER_API_URL)
            else:
                exercises = []
                for page in json.loads(file.read_text(encoding="utf-8")):
                    exercises.extend(wger.parse_page(page)[0])
            report = import_wger_exercises(exercises=exercises)
        except (wger.WgerError, EmptyCatalogError, OSError, json.JSONDecodeError) as error:
            raise CommandError(f"Import interrompu, catalogue inchangé : {error!r}") from error
        self.stdout.write(
            f"Exercices : {report.created} créés, {report.updated} mis à jour, "
            f"{report.deactivated} désactivés, {report.skipped} ignorés."
        )
