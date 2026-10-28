"""Chiffrement au repos des secrets et champs sensibles (ADR 0002) : Fernet avec rotation.

Les clés viennent de `settings.FIELD_ENCRYPTION_KEYS` : la première chiffre, toutes
déchiffrent. Une valeur altérée en base lève `cryptography.fernet.InvalidToken`.
"""

from pathlib import Path

from cryptography.fernet import Fernet, MultiFernet
from django.conf import settings


def keys_from_env(value: str) -> list[str]:
    """Clés Fernet de `FIELD_ENCRYPTION_KEYS`, séparées par des virgules (la première chiffre).

    Une valeur absente ou invalide arrête le démarrage plutôt que de stocker en clair.
    """
    keys = [key.strip() for key in value.split(",") if key.strip()]
    if not keys:
        raise ValueError("FIELD_ENCRYPTION_KEYS doit contenir au moins une clé Fernet")
    for key in keys:
        try:
            Fernet(key.encode())
        except ValueError as error:
            raise ValueError("FIELD_ENCRYPTION_KEYS contient une clé Fernet invalide") from error
    return keys


def dev_encryption_key(path: Path) -> list[str]:
    """Clé de développement : créée au premier démarrage puis réutilisée (fichier ignoré)."""
    if not path.exists():
        path.write_text(Fernet.generate_key().decode())
        path.chmod(0o600)
    return keys_from_env(path.read_text())


def _fernet() -> MultiFernet:
    keys: list[str] = settings.FIELD_ENCRYPTION_KEYS
    return MultiFernet([Fernet(key.encode()) for key in keys])


def encrypt(text: str) -> str:
    return _fernet().encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
