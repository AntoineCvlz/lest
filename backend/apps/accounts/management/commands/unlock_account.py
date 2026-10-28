from argparse import ArgumentParser
from typing import Any

from allauth.core import ratelimit
from django.core.management.base import BaseCommand
from django.test import RequestFactory

from apps.accounts.adapter import DAILY_FAILURES


class Command(BaseCommand):
    help = (
        "Support : lève le plafond journalier des seconds facteurs refusés d'un compte, après "
        "vérification de l'identité du titulaire (le plafond n'est jamais levé par un reset)."
    )

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("--email", required=True)

    def handle(self, *args: Any, email: str, **options: Any) -> None:
        # Le compteur d'allauth s'efface via une requête ; aucune information n'en est lue.
        ratelimit.clear(RequestFactory().get("/"), action=DAILY_FAILURES, key=email.lower())
        self.stdout.write(f"Plafond levé pour {email.lower()}")
