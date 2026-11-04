from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from apps.body import demo, services

DEMO_EMAIL = "demo@example.com"


class Command(BaseCommand):
    help = (
        "Pesées et mensurations de démo (dev uniquement) : 8 semaines de prise de masse pour le "
        f"compte {DEMO_EMAIL} (ou --email). Relançable : rien n'est dupliqué."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--email", default=DEMO_EMAIL)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Données de démo réservées au développement (DEBUG=True).")
        owner = get_user_model().objects.filter(email=email).first()
        if owner is None:
            raise CommandError(f"Compte {email} introuvable : lancer d'abord seed_demo.")
        today = timezone.localdate()
        weights = demo.weights(today=today)
        for weight in weights:
            services.put_weight(owner=owner, day=weight.day, weight_kg=weight.weight_kg)
        measurements = demo.measurements(today=today)
        for one in measurements:
            services.put_measurement(owner=owner, day=one.day, site=one.site, length_m=one.length_m)
        self.stdout.write(
            f"Corps de démo prêt : {len(weights)} pesées, {len(measurements)} mensurations."
        )
