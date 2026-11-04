from datetime import date
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from apps.nutrition import demo, selectors, services

DEMO_EMAIL = "demo@example.com"
DEMO_TARGETS = services.TargetValues(
    sex="male",
    birth_date=date(1996, 5, 12),
    activity="moderate",
    kcal=None,
    protein_g=None,
    carbs_g=None,
    fat_g=None,
)


class Command(BaseCommand):
    help = (
        "Journal alimentaire de démo (dev uniquement) : aliments perso, deux semaines de repas "
        f"et d'eau, objectifs calculés pour le compte {DEMO_EMAIL} (ou --email). Relançable : "
        "rien n'est dupliqué, des objectifs déjà réglés sont gardés."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--email", default=DEMO_EMAIL)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Données de démo réservées au développement (DEBUG=True).")
        owner = get_user_model().objects.filter(email=email).first()
        if owner is None:
            raise CommandError(f"Compte {email} introuvable : lancer d'abord seed_demo.")
        for food in demo.FOODS.values():
            services.put_custom_food(
                owner=owner,
                food_id=food.id,
                values=services.CustomFoodValues(
                    name=food.name,
                    brand="",
                    kcal_100g=food.kcal_100g,
                    protein_100g=food.protein_100g,
                    carbs_100g=food.carbs_100g,
                    fat_100g=food.fat_100g,
                    serving_g=food.serving_g,
                ),
            )
        days = demo.plan(today=timezone.localdate())
        for day in days:
            for entry in day.entries:
                services.put_entry(
                    owner=owner,
                    entry_id=entry.id,
                    day=entry.day,
                    meal=entry.meal,
                    food_id=entry.food_id,
                    grams=entry.grams,
                )
            services.put_water(owner=owner, day=day.day, ml=day.water_ml)
        if not selectors.targets_view(owner=owner).configured:
            services.put_targets(owner=owner, values=DEMO_TARGETS)
        entries = sum(len(day.entries) for day in days)
        self.stdout.write(
            f"Nutrition de démo prête : {len(demo.FOODS)} aliments, {len(days)} jours, "
            f"{entries} entrées, objectifs activés."
        )
