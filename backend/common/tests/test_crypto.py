from pathlib import Path

import pytest
from cryptography.fernet import Fernet, InvalidToken
from django.test import override_settings

from common.crypto import decrypt, dev_encryption_key, encrypt, keys_from_env


def test_round_trip_never_stores_the_clear_text() -> None:
    token = encrypt("JBSWY3DPEHPK3PXP")

    assert "JBSWY3DPEHPK3PXP" not in token
    assert decrypt(token) == "JBSWY3DPEHPK3PXP"


def test_old_keys_still_decrypt_after_a_rotation() -> None:
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    with override_settings(FIELD_ENCRYPTION_KEYS=[old]):
        token = encrypt("secret")

    with override_settings(FIELD_ENCRYPTION_KEYS=[new, old]):
        assert decrypt(token) == "secret"
        rotated = encrypt("secret")
    with override_settings(FIELD_ENCRYPTION_KEYS=[new]):
        assert decrypt(rotated) == "secret"


def test_a_tampered_value_is_refused() -> None:
    token = encrypt("secret")
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")

    with pytest.raises(InvalidToken):
        decrypt(tampered)


def test_keys_from_env_accepts_a_comma_separated_list() -> None:
    first, second = Fernet.generate_key().decode(), Fernet.generate_key().decode()

    assert keys_from_env(f" {first} , {second} ") == [first, second]


@pytest.mark.parametrize("value", ["", "pas-une-cle", "  ,  "])
def test_keys_from_env_refuses_invalid_values(value: str) -> None:
    with pytest.raises(ValueError, match="FIELD_ENCRYPTION_KEYS"):
        keys_from_env(value)


def test_dev_key_is_created_once_then_reused(tmp_path: Path) -> None:
    path = tmp_path / "field-encryption-dev.key"

    first = dev_encryption_key(path)
    second = dev_encryption_key(path)

    assert first == second
    Fernet(first[0].encode())
