from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser

from apps.activities import services


class Command(BaseCommand):
    help = (
        "Recopie en séances terminées les activités qui n'en ont pas encore (ADR 0017). "
        "Relançable : une séance déjà recopiée n'est pas réécrite. --check : n'écrit rien, "
        "échoue s'il reste une activité sans sa séance."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--check", action="store_true")

    def handle(self, *args: Any, check: bool, **options: Any) -> None:
        if check:
            missing = services.missing_copies()
            if missing:
                raise CommandError(f"{missing} activités sans leur séance recopiée.")
            self.stdout.write("Toutes les activités ont leur séance.")
            return
        report = services.copy_activities_to_workouts()
        self.stdout.write(
            f"{report.activities} activités, {report.created} séances recopiées "
            "(les autres l'étaient déjà)."
        )
