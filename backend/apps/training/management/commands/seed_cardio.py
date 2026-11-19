from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from apps.training import cardio_demo, services

DEMO_EMAIL = "demo@example.com"


class Command(BaseCommand):
    help = (
        "Séances de cardio de démo (dev uniquement) : 8 semaines de course et de natation pour "
        f"le compte {DEMO_EMAIL} (ou --email). Relançable : rien n'est dupliqué."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--email", default=DEMO_EMAIL)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Données de démo réservées au développement (DEBUG=True).")
        owner = get_user_model().objects.filter(email=email).first()
        if owner is None:
            raise CommandError(f"Compte {email} introuvable : lancer d'abord seed_demo.")
        sessions = cardio_demo.plan(today=timezone.localdate())
        for one in sessions:
            services.put_cardio_workout(owner=owner, workout_id=one.id, values=one.values)
        self.stdout.write(f"Séances de cardio de démo prêtes : {len(sessions)} séances.")
