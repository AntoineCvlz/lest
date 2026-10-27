import json
from argparse import ArgumentParser
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand

from apps.accounts.auth_schema import auth_schema


class Command(BaseCommand):
    help = "Écrit la spécification OpenAPI des routes d'allauth (client du front)."

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--output", type=Path, required=True)

    def handle(self, *args: Any, output: Path, **options: Any) -> None:
        content = json.dumps(auth_schema(), indent=2, sort_keys=True, ensure_ascii=False)
        # LF explicite : sous Windows, `write_text` écrirait des CRLF (dépôt en LF).
        output.write_text(content + "\n", encoding="utf-8", newline="\n")
