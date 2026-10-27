import os
from argparse import ArgumentParser
from typing import Any

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.services import create_verified_user

# Nom de la variable d'environnement qui porte le mot de passe (pas le mot de passe lui-même).
ENV_NAME = "LEST_USER_PASSWORD"


class Command(BaseCommand):
    help = (
        "Crée un compte à l'e-mail vérifié (E2E, démo). Mot de passe lu dans la variable "
        f"{ENV_NAME}, jamais en argument (visible dans la liste des processus)."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--email", required=True)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        password = os.environ.get(ENV_NAME, "")
        if not password:
            raise CommandError(f"Définir la variable {ENV_NAME}.")
        try:
            user = create_verified_user(email=email, password=password)
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from error
        self.stdout.write(f"Compte créé : {user.email}")
