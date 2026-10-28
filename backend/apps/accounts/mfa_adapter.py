from allauth.mfa.adapter import DefaultMFAAdapter

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
