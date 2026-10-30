from importlib import import_module

from django.apps import AppConfig


class TrainingConfig(AppConfig):
    name = "apps.training"
    label = "training"
    verbose_name = "Musculation"

    def ready(self) -> None:
        # Récepteurs des événements de domaine émis par accounts.
        import_module("apps.training.receivers")
