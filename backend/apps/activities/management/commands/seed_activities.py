from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from apps.activities import demo, services

DEMO_EMAIL = "demo@example.com"


class Command(BaseCommand):
    help = (
        "Activités de démo (dev uniquement) : 8 semaines de course et de natation pour le compte "
        f"{DEMO_EMAIL} (ou --email). Relançable : rien n'est dupliqué."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--email", default=DEMO_EMAIL)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Données de démo réservées au développement (DEBUG=True).")
        owner = get_user_model().objects.filter(email=email).first()
        if owner is None:
            raise CommandError(f"Compte {email} introuvable : lancer d'abord seed_demo.")
        activities = demo.plan(today=timezone.localdate())
        for one in activities:
            services.put_activity(
                owner=owner,
                activity_id=one.id,
                values=services.ActivityValues(
                    day=one.day,
                    sport=one.sport,
                    duration_s=one.duration_s,
                    distance_m=one.distance_m,
                    avg_heart_rate=one.avg_heart_rate,
                    feeling=one.feeling,
                    metrics=one.metrics,
                ),
            )
        self.stdout.write(f"Activités de démo prêtes : {len(activities)} activités.")
