from allauth.account.adapter import DefaultAccountAdapter

from .models import normalize_email


class AccountAdapter(DefaultAccountAdapter):
    """Adaptateur allauth : mêmes règles d'e-mail que le modèle `User`."""

    def clean_email(self, email: str) -> str:
        # Normalisation identique au manager : « Antoine@X.fr » et « antoine@x.fr » sont un seul
        # compte (la contrainte Lower(email) en base le garantit de toute façon).
        return normalize_email(super().clean_email(email))
