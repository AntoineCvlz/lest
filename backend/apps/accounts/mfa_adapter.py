from urllib.parse import urlsplit

from allauth.mfa.adapter import DefaultMFAAdapter
from django.conf import settings

from common import crypto


class MFAAdapter(DefaultMFAAdapter):
    """Secrets MFA (clé TOTP, graine des codes de secours) chiffrés en base (ADR 0002).

    L'adaptateur d'allauth les stocke en clair par défaut : une fuite de la base suffirait
    alors à produire des codes valides pour chaque compte.
    """

    def encrypt(self, text: str) -> str:
        return crypto.encrypt(text)

    def decrypt(self, encrypted_text: str) -> str:
        return crypto.decrypt(encrypted_text)

    def get_public_key_credential_rp_entity(self) -> dict[str, str]:
        """Passkeys liées au domaine public de Lest.

        allauth prendrait l'hôte de la requête : derrière le proxy Next.js, c'est l'hôte interne
        de l'API (`api` en dev), et le navigateur refuserait toute passkey.
        """
        return {"id": urlsplit(settings.FRONTEND_URL).hostname or "", "name": "Lest"}
