# Commandes du projet : `just` pour la liste. Fonctionne sous Windows (pwsh), macOS et Linux.

set windows-shell := ["pwsh", "-NoLogo", "-NoProfile", "-Command"]
set dotenv-load := false

# Les conteneurs de dev ne renvoient pas leurs fichiers vers l'hôte (sync à sens unique) :
# les commandes qui écrivent du code (migrations, formatage, schéma) montent le dossier.
api_rw := "docker compose run --rm --no-deps -v ./backend:/app api"
web_rw := "docker compose run --rm --no-deps -v ./frontend:/app -v /app/node_modules -v /app/.next -v ./backend/openapi.json:/backend/openapi.json:ro -v ./backend/auth-openapi.json:/backend/auth-openapi.json:ro web"

[private]
default:
    @just --list

# Installe les hooks git (pre-commit + commit-msg) ; prérequis : `uv tool install pre-commit`
hooks:
    pre-commit install

# Lance toutes les vérifications pre-commit sur tout le dépôt
check:
    pre-commit run --all-files

# Lance toute la stack avec rechargement à chaud (Ctrl+C pour arrêter)
up:
    docker compose up --build --watch

# Arrête la stack (les données Postgres sont conservées)
down:
    docker compose down

# Suit les journaux (tous les services, ou ceux indiqués)
logs *services:
    docker compose logs --follow {{ services }}

# Ouvre un shell dans le conteneur de l'API
sh-api:
    docker compose exec api bash

# Données de démo (dev) : compte demo@example.com vérifié + profil ; mot de passe lu dans
# LEST_USER_PASSWORD (à définir dans le terminal, jamais en argument)
seed:
    docker compose exec -e LEST_USER_PASSWORD api python manage.py seed_demo

# Applique les migrations
migrate:
    docker compose exec api python manage.py migrate

# Crée les migrations (écrites dans ./backend)
makemigrations *args:
    {{ api_rw }} python manage.py makemigrations {{ args }}

# Lance tous les tests (back puis front)
test:
    docker compose exec api pytest
    docker compose exec web pnpm test

# Vérifie lint, formatage et types (back puis front)
lint:
    docker compose exec api ruff check .
    docker compose exec api ruff format --check .
    docker compose exec api mypy .
    docker compose exec web pnpm lint
    docker compose exec web pnpm format:check
    docker compose exec web pnpm typecheck

# Formate le code (écrit dans ./backend et ./frontend)
fmt:
    {{ api_rw }} ruff check --fix .
    {{ api_rw }} ruff format .
    {{ web_rw }} pnpm format

# Régénère le schéma OpenAPI puis le client TypeScript
typegen:
    {{ api_rw }} python manage.py export_openapi_schema --api config.api.api --indent 2 --sorted --output openapi.json
    {{ api_rw }} python manage.py export_auth_schema --output auth-openapi.json
    {{ web_rw }} pnpm typegen

# Supprime la base de dev et la recrée vide (migrations appliquées)
reset-db:
    docker compose rm --stop --force db
    docker volume rm --force lest_pgdata
    docker compose up --detach --wait db
    docker compose run --rm api python manage.py migrate
