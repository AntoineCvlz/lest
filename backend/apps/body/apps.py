from importlib import import_module

from django.apps import AppConfig


class BodyConfig(AppConfig):
    name = "apps.body"
    label = "body"
    verbose_name = "Corps"

    def ready(self) -> None:
        # Fichiers des photos effacés avec leur ligne.
        import_module("apps.body.receivers")
