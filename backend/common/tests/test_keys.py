from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

from common.keys import dev_private_key, generate_rsa_private_key_pem, private_key_from_env


def test_generated_key_is_a_3072_bit_rsa_private_key_in_pem() -> None:
    pem = generate_rsa_private_key_pem()

    key = serialization.load_pem_private_key(pem.encode(), password=None)
    assert isinstance(key, RSAPrivateKey)
    assert key.key_size == 3072


def test_env_value_with_escaped_newlines_is_restored() -> None:
    pem = generate_rsa_private_key_pem()

    assert private_key_from_env(pem.replace("\n", "\\n")) == pem


def test_env_value_must_be_a_private_key() -> None:
    with pytest.raises(ValueError, match="JWT_PRIVATE_KEY"):
        private_key_from_env("pas-une-cle")


def test_small_rsa_keys_are_refused() -> None:
    small = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = small.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()

    with pytest.raises(ValueError, match="3072"):
        private_key_from_env(pem)


def test_dev_key_is_created_once_then_reused(tmp_path: Path) -> None:
    path = tmp_path / "jwt-dev.pem"

    first = dev_private_key(path)

    assert dev_private_key(path) == first
