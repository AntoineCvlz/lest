import os

# Valeurs par défaut non secrètes : les tests et mypy (plugin django-stubs) chargent ces
# réglages sans configuration ; l'environnement (CI, conteneur) reste prioritaire.
os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-insecure-key")
os.environ.setdefault("DATABASE_URL", "postgres://lest:lest@localhost:5432/lest")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from cryptography.fernet import Fernet

from common.keys import generate_rsa_private_key_pem

from .base import *  # noqa: F403

# Clé JWT éphémère, propre à chaque exécution des tests.
HEADLESS_JWT_PRIVATE_KEY = generate_rsa_private_key_pem()
# Clé de chiffrement au repos éphémère (ADR 0002).
FIELD_ENCRYPTION_KEYS = [Fernet.generate_key().decode()]

# Hash rapide : les tests ne mesurent pas la robustesse du stockage des mots de passe.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Cache local : les tests unitaires ne dépendent pas de Redis.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
