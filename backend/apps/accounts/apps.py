from importlib import import_module

from django.apps import AppConfig

# Bibliothèque de tags de templates d'allauth, en tête d'une chaîne d'imports circulaires
# (`account.utils` → `internal.flows` → `stages` → `internal.constants`).
ALLAUTH_TEMPLATE_TAGS = "allauth.account.templatetags.account"


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    label = "accounts"
    verbose_name = "Comptes"

    def ready(self) -> None:
        # Sous `runserver`, deux fils instancient le moteur de templates en même temps : le
        # rechargeur (dossiers de templates à surveiller) et les vérifications système. Chacun
        # importe ces tags, et leurs imports circulaires se croisent : `_DeadlockError` au
        # démarrage, au hasard. Les importer ici, avant le lancement des fils, supprime la course.
        import_module(ALLAUTH_TEMPLATE_TAGS)
        import_module("apps.accounts.checks")  # enregistre les vérifications système
        import_module("apps.accounts.signals")  # branche les récepteurs (alertes MFA)
        # Passkeys : origine exacte (voir `apps.accounts.webauthn`). allauth appelle
        # `get_server()` de ce module à chaque cérémonie ; un test vérifie le remplacement.
        from allauth.mfa.webauthn.internal import auth as webauthn_auth

        from apps.accounts.webauthn import get_server

        webauthn_auth.get_server = get_server
