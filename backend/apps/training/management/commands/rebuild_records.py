from typing import Any

from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.training.models import Workout
from apps.training.services import rebuild_records


class Command(BaseCommand):
    help = (
        "Reconstruit les records de chaque compte depuis ses séries (nouveaux types de record, "
        "ADR 0017). Rejouable ; ne journalise ni compte ni valeur."
    )

    def handle(self, *args: Any, **options: Any) -> None:
        owners = User.objects.filter(
            pk__in=Workout.objects.values_list("owner_id", flat=True).distinct()
        )
        accounts = records = 0
        for owner in owners.iterator():
            records += rebuild_records(owner=owner)
            accounts += 1
        self.stdout.write(f"Records reconstruits : {accounts} comptes, {records} records.")
