# Contribuer à Lest

Lest est un projet propriétaire (voir `LICENSE`). Les contributions externes ne sont acceptées que sur invitation ; ce document décrit le flux de travail interne.

## Prérequis

- Docker Desktop (ou Docker Engine + Compose v2)
- [`just`](https://github.com/casey/just)
- [`uv`](https://docs.astral.sh/uv/) pour `pre-commit`
- Node.js LTS avec `corepack` activé (pnpm)

Le démarrage complet est décrit dans le `README.md`.

## Flux de travail

1. Une branche par intention : `feat/<domaine>-<sujet>`, `fix/…`, `chore/…`, `docs/…`, `ci/…`.
2. Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/) : `feat(training): détecter les records à l'enregistrement d'une série`. Vérifiés par commitlint.
3. Commits signés (SSH ou GPG).
4. PR petite (< 400 lignes hors fichiers générés), une seule intention, description complète via le modèle de PR, captures mobile et desktop pour toute UI.
5. Fusion en squash une fois tous les checks verts.

## Règles de qualité

- Logique métier en TDD, uniquement dans `services` (écritures) et `selectors` (lectures).
- Tests de permissions sur chaque endpoint : un utilisateur ne lit ni ne modifie jamais les données d'un autre.
- Aucun test, règle de lint ou contrôle de sécurité désactivé pour faire passer la CI.
- Toute nouvelle dépendance est justifiée dans la PR (besoin, alternatives, licence, maintenance).
- Toute décision structurante fait l'objet d'un ADR dans `docs/adr/`.
- Le client API TypeScript est régénéré (`just typegen`) dès que l'API change.

Le détail des conventions se trouve dans `CLAUDE.md`.
