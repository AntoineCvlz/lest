from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.utils import timezone

from apps.training import demo, services
from apps.training.models import Exercise

DEMO_EMAIL = "demo@example.com"


class Command(BaseCommand):
    help = (
        "Séances de démo (dev uniquement) : 8 semaines de poussée, tirage et jambes pour le "
        f"compte {DEMO_EMAIL} (ou --email). Exige le catalogue (import_exercises). Relançable : "
        "les séances sont remplacées, jamais dupliquées."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--email", default=DEMO_EMAIL)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        if not settings.DEBUG:
            raise CommandError("Données de démo réservées au développement (DEBUG=True).")
        owner = get_user_model().objects.filter(email=email).first()
        if owner is None:
            raise CommandError(f"Compte {email} introuvable : lancer d'abord seed_demo.")
        catalog = {
            exercise.source_id: exercise.pk
            for exercise in Exercise.objects.filter(source_id__in=demo.SOURCE_IDS, is_active=True)
        }
        missing = sorted(set(demo.SOURCE_IDS) - set(catalog))
        if missing:
            raise CommandError(
                f"Exercices absents du catalogue : {', '.join(missing)}. Lancer import_exercises."
            )

        workouts = demo.plan(today=timezone.localdate())
        for workout in workouts:
            services.put_workout(
                owner=owner,
                workout_id=workout.id,
                started_at=workout.started_at,
                ended_at=workout.ended_at,
            )
            for item in workout.exercises:
                services.put_workout_exercise(
                    owner=owner,
                    workout_exercise_id=item.id,
                    workout_id=workout.id,
                    exercise_id=catalog[item.source_id],
                    position=item.position,
                )
                for one in item.sets:
                    services.put_set(
                        owner=owner,
                        set_id=one.id,
                        workout_exercise_id=item.id,
                        position=one.position,
                        weight_kg=one.weight_kg,
                        reps=one.reps,
                        rpe=one.rpe,
                        is_warmup=one.is_warmup,
                        performed_at=one.performed_at,
                    )
        sets = sum(len(item.sets) for workout in workouts for item in workout.exercises)
        self.stdout.write(f"Séances de démo prêtes : {len(workouts)} séances, {sets} séries.")
