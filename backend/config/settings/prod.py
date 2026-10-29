"""Réglages de production : pas encore déployés, mais vérifiés en CI par `check --deploy`."""

from common.crypto import keys_from_env
from common.keys import private_key_from_env

from .base import *  # noqa: F403
from .base import env

HEADLESS_JWT_PRIVATE_KEY = private_key_from_env(env("JWT_PRIVATE_KEY"))
FIELD_ENCRYPTION_KEYS = keys_from_env(env("FIELD_ENCRYPTION_KEYS"))
# Origine publique : liens des e-mails et domaine des passkeys (contrôle accounts.E003).
FRONTEND_URL = env("FRONTEND_URL").rstrip("/")

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 365)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
# Désactivable seulement pour la stack E2E (Mailpit local, sans STARTTLS).
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
