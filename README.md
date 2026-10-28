# Lest

Suivi de prise de masse, de musculation et de sport, pensé pour être utilisé d'une main entre deux séries, même sans réseau en salle.

> Projet en Phase 1 : comptes (inscription avec code e-mail, connexion, mot de passe oublié), onboarding et profil, design system « Fonte calibrée ». Les fonctionnalités d'entraînement arrivent en Phase 2, voir la [roadmap](CLAUDE.md#roadmap).

## Ce que fait Lest

- **Musculation** : séances, séries, charges, RPE, minuteur de repos, records personnels.
- **Corps** : poids quotidien et moyenne mobile, mensurations, photos de progression privées.
- **Nutrition** : journal alimentaire, Open Food Facts, scan code-barres, objectifs caloriques et macros.
- **Autres sports** : course, vélo, natation, sports collectifs, combat…
- **Basic-Fit** (optionnel) : visites, pesées des balances en club, clubs, recettes.

Les données appartiennent à l'utilisateur : export CSV/JSON et suppression complète du compte.

## Démarrage

Prérequis : Docker (Compose v2.22+) et [`just`](https://github.com/casey/just).

```sh
cp .env.example .env      # puis ajuster DJANGO_SECRET_KEY (et les ports si besoin)
just up                   # construit et lance toute la stack, rechargement à chaud
just migrate              # dans un second terminal, au premier démarrage
```

| Service | URL |
| --- | --- |
| Application | http://localhost:3000 (`WEB_PORT`) |
| API + doc interactive | http://localhost:8000/api/v1/docs/ |
| E-mails capturés (Mailpit) | http://localhost:8025 |

Créer un compte déjà vérifié (démo, tests manuels) ; le mot de passe est lu dans l'environnement :

```sh
LEST_USER_PASSWORD='…' docker compose exec -e LEST_USER_PASSWORD api python manage.py create_verified_user --email moi@example.com
```

Sinon, s'inscrire sur `/inscription` et lire le code dans Mailpit.

`just` liste toutes les commandes : `test`, `lint`, `fmt`, `typegen`, `makemigrations`, `reset-db`… Composants : `pnpm --dir frontend storybook` (port 6006). E2E : voir [CLAUDE.md](CLAUDE.md#décisions-et-constats-de-la-phase-1-à-respecter) (build de prod en local).

## Architecture

Navigateur → Next.js (SSR + proxy `/api`) → API Django Ninja → PostgreSQL / Redis, avec un worker Celery.

Le proxy Next.js est un *Backend for Frontend* : les jetons JWT d'allauth ne quittent jamais le serveur ; le navigateur n'a que des cookies `HttpOnly`, et aucun jeton n'est lisible par le JavaScript.

Détails : [architecture (C4)](docs/architecture.md) et les décisions dans [`docs/adr/`](docs/adr/) :

- [ADR 0001 — authentification JWT `django-allauth` derrière un proxy Next.js (BFF)](docs/adr/0001-choix-auth.md)

## Qualité et sécurité

Chaque PR passe 22 contrôles : lint et types (ruff, mypy strict, ESLint, tsc), tests back et front, E2E Playwright + axe sur les images de prod, `check --deploy`, CodeQL, Semgrep, Bandit, Gitleaks, audits de dépendances, Hadolint et Trivy. Actions épinglées par SHA, images d'outils par digest, commits signés, Dependabot avec délai de 3 jours.

## Licence

Propriétaire, tous droits réservés. Voir [LICENSE](LICENSE).
