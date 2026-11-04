# Lest

Suivi de prise de masse, de musculation et de sport, pensé pour être utilisé d'une main entre deux séries, même sans réseau en salle.

> Phases 1 à 3 terminées :
> - comptes sécurisés : code e-mail, double authentification, passkeys, export et suppression RGPD ;
> - **musculation** : catalogue de 701 exercices illustrés, saisie d'une série en un appui, minuteur de repos, records et programmes ;
> - **corps et nutrition** : pesées, mensurations, photos de progression chiffrées, journal des repas (table Ciqual, code-barres Open Food Facts), objectifs calculés.
>
> Prochaine étape, les autres sports et le tableau de bord (Phase 4) : voir la [roadmap](CLAUDE.md#roadmap).

## Ce que fait Lest

- **Musculation** : séances, séries, charges, RPE, minuteur de repos, records personnels, programmes avec cibles et charge suggérée, catalogue illustré (données RepDB).
- **Corps** : pesées et moyenne mobile sur 7 jours, mensurations, photos de progression chiffrées (archive ZIP téléchargeable).
- **Nutrition** : journal des repas et de l'eau, aliments de la table Ciqual (Anses), produits Open Food Facts au scan du code-barres, aliments perso, objectifs caloriques et macros calculés et modifiables.
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

Compte de démo (`demo@example.com`, profil rempli, 8 semaines de séances poussée/tirage/jambes avec leurs records, 8 semaines de pesées et de mensurations, 2 semaines de repas et objectifs nutritionnels) : définir `LEST_USER_PASSWORD` dans le terminal, puis `just seed` (la première fois, importe aussi le catalogue RepDB avec ses images et la table Ciqual : quelques minutes). Autre compte déjà vérifié ; le mot de passe est lu dans l'environnement :

```sh
LEST_USER_PASSWORD='…' docker compose exec -e LEST_USER_PASSWORD api python manage.py create_verified_user --email moi@example.com
```

Sinon, s'inscrire sur `/inscription` et lire le code dans Mailpit.

`just` liste toutes les commandes : `test`, `lint`, `fmt`, `typegen`, `makemigrations`, `reset-db`… Composants : `pnpm --dir frontend storybook` (port 6006). E2E : voir [CLAUDE.md](CLAUDE.md#décisions-et-constats-de-la-phase-1-à-respecter) (build de prod en local).

## Architecture

Navigateur → Next.js (SSR + proxy `/api`) → API Django Ninja → PostgreSQL / Redis, avec un worker Celery et son planificateur (`beat`).

Le proxy Next.js est un *Backend for Frontend* : les jetons JWT d'allauth ne quittent jamais le serveur ; le navigateur n'a que des cookies `HttpOnly`, et aucun jeton n'est lisible par le JavaScript.

Détails : [architecture (C4)](docs/architecture.md) et les décisions dans [`docs/adr/`](docs/adr/) :

- [ADR 0001 — authentification JWT `django-allauth` derrière un proxy Next.js (BFF)](docs/adr/0001-choix-auth.md)
- [ADR 0002 — chiffrement au repos des secrets et champs sensibles (Fernet)](docs/adr/0002-chiffrement-au-repos.md)
- [ADR 0003 — écritures de séance idempotentes (UUID client, `PUT`), pour le hors-ligne](docs/adr/0003-ecritures-idempotentes-hors-ligne.md)
- [ADR 0004 — catalogue d'exercices importé de wger, sous licence CC-BY-SA](docs/adr/0004-donnees-exercices-wger.md) (remplacé par l'ADR 0006)
- [ADR 0005 — images des exercices : wger normalisées et servies par Lest, pictogrammes sinon](docs/adr/0005-images-exercices.md) (remplacé par l'ADR 0006)
- [ADR 0006 — catalogue d'exercices et images de RepDB, à la place de wger](docs/adr/0006-catalogue-repdb.md)
- [ADR 0007 — mesures corporelles chiffrées, tendances calculées en Python](docs/adr/0007-mesures-corporelles-chiffrees.md)
- [ADR 0008 — photos de progression chiffrées sur un volume privé](docs/adr/0008-photos-de-progression.md)
- [ADR 0009 — aliments : Ciqual en local, Open Food Facts au scan du code-barres](docs/adr/0009-aliments-ciqual-open-food-facts.md)
- [ADR 0010 — journal alimentaire chiffré, aliment recopié à la saisie](docs/adr/0010-journal-alimentaire-chiffre.md)
- [ADR 0011 — objectifs nutritionnels calculés et modifiables, données chiffrées](docs/adr/0011-objectifs-nutritionnels.md)
- [ADR 0012 — activités : catalogue de sports fixe, métriques validées, valeurs chiffrées](docs/adr/0012-activites-catalogue-de-sports.md)
- [ADR 0013 — tableau de bord : lectures agrégées par les sélecteurs des domaines, en une route](docs/adr/0013-tableau-de-bord.md)

## Qualité et sécurité

Chaque PR passe 22 contrôles : lint et types (ruff, mypy strict, ESLint, tsc), tests back et front, E2E Playwright + axe sur les images de prod, `check --deploy`, CodeQL, Semgrep, Bandit, Gitleaks, audits de dépendances, Hadolint et Trivy. Actions épinglées par SHA, images d'outils par digest, commits signés, Dependabot avec délai de 3 jours.

## Licence

Propriétaire, tous droits réservés. Voir [LICENSE](LICENSE).
