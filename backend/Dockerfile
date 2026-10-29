# syntax=docker/dockerfile:1.7
# Étapes : base → dev (Compose) → build → prod (image finale minimale, sans outils de build).

FROM ghcr.io/astral-sh/uv:0.13.5 AS uv

FROM python:3.13.17-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:${PATH}"
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app

# --- Dev : dépendances de dev incluses, code synchronisé par `develop.watch` -------------
FROM base AS dev
COPY --from=uv /uv /usr/local/bin/uv
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project
COPY --chown=app:app . .
# Caches d'outils (ruff, pytest, coverage) écrits dans /app par l'utilisateur non-root ;
# clés de dev dans un volume partagé par api et worker (créé avec ces droits, voir compose.yaml).
RUN chown app:app /app && install -d -o app -g app -m 700 /var/lib/lest-keys
USER 10001:10001
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# --- Build : dépendances de prod uniquement + fichiers statiques -------------------------
FROM base AS build
COPY --from=uv /uv /usr/local/bin/uv
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --no-install-project
COPY . .
# Valeurs factices : collectstatic n'ouvre aucune connexion. Aucun secret dans l'image : la
# clé JWT et la clé de chiffrement sont générées pour cette seule commande (ni ARG ni ENV),
# puis jetées.
RUN JWT_PRIVATE_KEY="$(python -c 'from common.keys import generate_rsa_private_key_pem as g; print(g())')" \
    FIELD_ENCRYPTION_KEYS="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
    DJANGO_SETTINGS_MODULE=config.settings.prod \
    DJANGO_SECRET_KEY=collectstatic-only \
    DJANGO_ALLOWED_HOSTS=localhost \
    DATABASE_URL=postgres://build@localhost/build \
    REDIS_URL=redis://localhost:6379/0 \
    EMAIL_HOST=localhost \
    FRONTEND_URL=https://build.invalid \
    python manage.py collectstatic --noinput

# --- Prod --------------------------------------------------------------------------------
FROM base AS prod
# uv gère les dépendances : pip n'a aucun usage à l'exécution. Retiré avec ses copies
# embarquées (urllib3, msgpack…) que Trivy signalait vulnérables.
RUN python -m pip uninstall --yes pip
COPY --from=build /opt/venv /opt/venv
COPY --from=build --chown=app:app /app /app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/', timeout=4).status == 200 else 1)"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
