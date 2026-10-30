"""Réglages communs à tous les environnements.

Toute valeur variable ou secrète vient de l'environnement (voir `.env.example`).
"""

from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = False
ALLOWED_HOSTS: list[str] = env.list("DJANGO_ALLOWED_HOSTS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Lookup `unaccent` pour la recherche du catalogue (extension créée par une migration).
    "django.contrib.postgres",
    "ninja",
    "allauth",
    "allauth.account",
    "allauth.headless",
    "allauth.mfa",
    # Sessions par appareil (liste, déconnexion à distance). IP complète et navigateur gardés
    # (choix produit), exportés et supprimés avec le compte. Activité non suivie
    # (`USERSESSIONS_TRACK_ACTIVITY`) : pas d'écriture en base à chaque requête.
    "allauth.usersessions",
    "apps.accounts",
    "apps.training",
]

# Défini avant toute migration de données : changer de modèle User ensuite est très coûteux.
AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "apps.accounts.middleware.RefusePasswordResetLookupMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DATABASE_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Argon2 en premier (CLAUDE.md, ASVS V2) ; les autres restent pour vérifier d'anciens hashs.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "fr"
TIME_ZONE = "Europe/Paris"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Cookies : HttpOnly et SameSite=Lax partout ; Secure activé en prod.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_TRUSTED_ORIGINS: list[str] = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

# En-têtes de sécurité (les en-têtes de la page web sont posés par Next.js).
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# Comptes : django-allauth en mode headless (ADR 0001). L'API est la seule interface ; le
# navigateur passe par le proxy Next.js. Codes à usage unique plutôt que liens (PWA).
HEADLESS_ONLY = True
HEADLESS_CLIENTS = ("app",)
ACCOUNT_ADAPTER = "apps.accounts.adapter.AccountAdapter"
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED = True
# Renvoi du code : 2 fois par parcours (au-delà, se reconnecter), 1 envoi par 10 s et par adresse.
ACCOUNT_EMAIL_VERIFICATION_SUPPORTS_RESEND = True
ACCOUNT_PASSWORD_RESET_BY_CODE_ENABLED = True
ACCOUNT_PREVENT_ENUMERATION = True  # mêmes réponses qu'un compte existe ou non
ACCOUNT_EMAIL_SUBJECT_PREFIX = "[Lest] "
# Le titulaire est prévenu par e-mail des changements sensibles (mot de passe réinitialisé…).
ACCOUNT_EMAIL_NOTIFICATIONS = True
# Défauts d'allauth, sauf les demandes de réinitialisation : 3 par 15 min et par adresse (au lieu
# de 5/min), pour qu'on ne puisse pas inonder une boîte, inscrite ou non, d'e-mails « [Lest] ».
ACCOUNT_RATE_LIMITS = {
    # Plafonds journaliers propres à Lest, en plus de `login_failed` d'allauth (5/5 min), en
    # actions distinctes (allauth partage l'historique de deux limites « key » d'une action) :
    # seconds facteurs refusés par compte (sans lui, ~1 440 codes TOTP/jour), jamais remis à zéro
    # par un reset ; mots de passe faux par (compte, IP), pour qu'un tiers ne bloque pas le compte.
    "login_failed_daily": "30/86400s/key",
    "login_failed_ip_daily": "50/86400s/key",
    # Options de connexion par passkey (GET, non limité par allauth) : chacune crée une session.
    "passkey_login_options": "10/m/ip",
    "reset_password": "20/m/ip,3/900s/key",
    # Réauthentification (ex. suppression du compte) : plafond journalier en plus de 10/min.
    "reauthenticate": "10/m/user,30/86400s/user",
    # Écritures de séance (séries, exercices, séances) : 300/min par compte, de quoi vider une
    # file hors ligne d'un coup, pas de remplir la base par script.
    "training_write": "300/m/user",
}
# Pages du front citées dans les e-mails. Avec les codes, seul l'e-mail « ce compte existe
# déjà » (envoyé à la place d'une erreur révélatrice) renvoie vers le front.
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000").rstrip("/")
HEADLESS_FRONTEND_URLS = {
    "account_signup": f"{FRONTEND_URL}/inscription",
    "account_reset_password": f"{FRONTEND_URL}/mot-de-passe-oublie",
}
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Lest <no-reply@lest.local>")

# Jetons JWT (ADR 0001) : RS256, accès 5 min, refresh 14 j renouvelé à chaque usage (l'ancien
# est invalidé), validation avec état pour que la déconnexion révoque aussi l'accès en cours.
# La clé privée est posée par chaque environnement (`dev`/`test` en génèrent une).
HEADLESS_TOKEN_STRATEGY = "allauth.headless.tokens.strategies.jwt.JWTTokenStrategy"  # noqa: S105 — chemin de classe
HEADLESS_JWT_ALGORITHM = "RS256"
HEADLESS_JWT_ACCESS_TOKEN_EXPIRES_IN = 5 * 60
HEADLESS_JWT_REFRESH_TOKEN_EXPIRES_IN = 14 * 24 * 60 * 60
HEADLESS_JWT_ROTATE_REFRESH_TOKEN = True
HEADLESS_JWT_STATEFUL_VALIDATION_ENABLED = True

# Double authentification (optionnelle) : application TOTP et codes de secours ; secrets chiffrés
# en base par `MFAAdapter` (ADR 0002). Jamais de `MFA_TOTP_INSECURE_BYPASS_CODE`.
MFA_ADAPTER = "apps.accounts.mfa_adapter.MFAAdapter"
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes", "webauthn"]
MFA_TOTP_ISSUER = "Lest"
# Passkeys : connexion sans mot de passe (clé résidente, vérification de l'utilisateur). Le RP ID
# est le domaine public (`FRONTEND_URL`), jamais l'hôte interne vu par Django derrière le proxy.
# Jamais de `MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN` (contrôle de déploiement accounts.E002).
MFA_PASSKEY_LOGIN_ENABLED = True

# Celery
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=env("REDIS_URL"))
CELERY_RESULT_BACKEND = None
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 300
CELERY_TASK_SOFT_TIME_LIMIT = 240
CELERY_TIMEZONE = TIME_ZONE
# Tâches périodiques, lancées par le service `beat` (une seule instance).
CELERY_BEAT_SCHEDULE = {
    "clear-expired-sessions": {
        "task": "common.tasks.clear_expired_sessions",
        "schedule": crontab(hour=4, minute=0),
    },
    # Catalogue d'exercices wger (ADR 0004), le 1er de chaque mois.
    "import-exercises": {
        "task": "apps.training.tasks.import_exercises",
        "schedule": crontab(day_of_month=1, hour=3, minute=30),
    },
}
# API publique de wger (catalogue d'exercices, ADR 0004).
WGER_API_URL = env("WGER_API_URL", default="https://wger.de/api/v2")

# Journaux : format sobre, jamais de corps de requête (données de santé, PII).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", default="INFO")},
}
