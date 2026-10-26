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
# Caches d'outils (ruff, pytest, coverage) écrits dans /app par l'utilisateur non-root.
RUN chown app:app /app
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
# Valeurs factices : collectstatic n'ouvre aucune connexion. Aucun secret dans l'image.
RUN DJANGO_SETTINGS_MODULE=config.settings.prod \
    DJANGO_SECRET_KEY=collectstatic-only \
    DJANGO_ALLOWED_HOSTS=localhost \
    DATABASE_URL=postgres://build@localhost/build \
    REDIS_URL=redis://localhost:6379/0 \
    EMAIL_HOST=localhost \
    python manage.py collectstatic --noinput

# --- Prod --------------------------------------------------------------------------------
FROM base AS prod
COPY --from=build /opt/venv /opt/venv
COPY --from=build --chown=app:app /app /app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/', timeout=4).status == 200 else 1)"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
