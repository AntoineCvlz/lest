import os
import subprocess
import sys
from pathlib import Path

from cryptography.fernet import Fernet
from django.conf import settings

from common.keys import generate_rsa_private_key_pem

BACKEND_DIR = Path(__file__).resolve().parents[2]


def test_argon2_is_the_production_password_hasher() -> None:
    from config.settings import base

    assert base.PASSWORD_HASHERS[0] == "django.contrib.auth.hashers.Argon2PasswordHasher"


def test_debug_is_off_outside_dev() -> None:
    assert settings.DEBUG is False


def test_prod_settings_pass_deploy_checks() -> None:
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.prod",
        "DJANGO_SECRET_KEY": "x" * 20 + "-deploy-check-only-" + "y" * 20,
        "DJANGO_ALLOWED_HOSTS": "lest.example",
        "DATABASE_URL": "postgres://u:p@localhost:5432/lest",
        "REDIS_URL": "redis://localhost:6379/0",
        "EMAIL_HOST": "smtp.example",
        "JWT_PRIVATE_KEY": generate_rsa_private_key_pem().replace("\n", "\\n"),
        "FIELD_ENCRYPTION_KEYS": Fernet.generate_key().decode(),
        "FRONTEND_URL": "https://lest.example",
    }
    result = subprocess.run(
        [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
