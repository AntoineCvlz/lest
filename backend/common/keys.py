"""Clé privée RSA qui signe les jetons JWT (ADR 0001)."""

from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

RSA_KEY_SIZE = 3072  # ≈ 128 bits de sécurité (recommandation ANSSI au-delà de 2030)


def generate_rsa_private_key_pem() -> str:
    """Génère une clé privée RSA au format PEM PKCS#8, non chiffrée."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=RSA_KEY_SIZE)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def private_key_from_env(value: str) -> str:
    """Valide la clé lue dans `JWT_PRIVATE_KEY` ; accepte les sauts de ligne échappés (`\\n`).

    Une valeur invalide arrête le démarrage plutôt que de signer avec une clé inattendue.
    """
    pem = value.replace("\\n", "\n")
    try:
        key = serialization.load_pem_private_key(pem.encode(), password=None)
    except ValueError as error:
        raise ValueError("JWT_PRIVATE_KEY n'est pas une clé privée PEM lisible") from error
    if not isinstance(key, RSAPrivateKey) or key.key_size < RSA_KEY_SIZE:
        raise ValueError(f"JWT_PRIVATE_KEY doit être une clé RSA d'au moins {RSA_KEY_SIZE} bits")
    return pem


def dev_private_key(path: Path) -> str:
    """Clé de développement : créée au premier démarrage puis réutilisée (fichier ignoré)."""
    if not path.exists():
        path.write_text(generate_rsa_private_key_pem())
        path.chmod(0o600)
    return private_key_from_env(path.read_text())
