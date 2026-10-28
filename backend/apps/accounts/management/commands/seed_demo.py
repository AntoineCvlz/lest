import os
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Goal, UnitSystem, User
from apps.accounts.selectors import get_profile
from apps.accounts.services import create_verified_user, save_profile

DEMO_EMAIL = "demo@example.com"
# Nom de la variable d'environnement qui porte le mot de passe (pas le mot de passe lui-même).
ENV_NAME = "LEST_USER_PASSWORD"


class Command(BaseCommand):
    help = (
        f"Données de démo (dev uniquement) : compte {DEMO_EMAIL} vérifié et son profil. "
        f"Mot de passe lu dans {ENV_NAME}. Relançable sans doublon."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Données de démo réservées au développement (DEBUG=True).")
        password = os.environ.get(ENV_NAME, "")
        if not password:
            raise CommandError(f"Définir la variable {ENV_NAME}.")

        user = User.objects.filter(email=DEMO_EMAIL).first()
        if user is None:
            try:
                user = create_verified_user(email=DEMO_EMAIL, password=password)
            except ValidationError as error:
                raise CommandError(" ".join(error.messages)) from error
        if get_profile(user) is None:
            save_profile(user=user, height_m=1.78, goal=Goal.GAIN, unit_system=UnitSystem.METRIC)
        self.stdout.write(f"Compte de démo prêt : {DEMO_EMAIL}")
