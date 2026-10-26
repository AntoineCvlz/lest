import os

# Valeurs par défaut non secrètes : les tests et mypy (plugin django-stubs) chargent ces
# réglages sans configuration ; l'environnement (CI, conteneur) reste prioritaire.
os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-insecure-key")
os.environ.setdefault("DATABASE_URL", "postgres://lest:lest@localhost:5432/lest")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")

from .base import *  # noqa: F403

# Hash rapide : les tests ne mesurent pas la robustesse du stockage des mots de passe.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Cache local : les tests unitaires ne dépendent pas de Redis.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
