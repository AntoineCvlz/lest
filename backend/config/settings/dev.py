from common.keys import dev_private_key, private_key_from_env

from .base import *  # noqa: F403
from .base import BASE_DIR, env

# Clé de signature JWT : celle de `.env` si définie, sinon une clé locale créée au premier
# démarrage (`*.pem` est ignoré par git) pour que `just up` marche sans configuration.
HEADLESS_JWT_PRIVATE_KEY = (
    private_key_from_env(env("JWT_PRIVATE_KEY"))
    if env("JWT_PRIVATE_KEY", default="")
    else dev_private_key(BASE_DIR / "jwt-dev.pem")
)

DEBUG = True
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1", "api"])

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST", default="mailpit")
EMAIL_PORT = env.int("EMAIL_PORT", default=1025)
