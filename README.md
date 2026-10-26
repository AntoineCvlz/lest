# Lest

Suivi de prise de masse, de musculation et de sport, pensé pour être utilisé d'une main entre deux séries, même sans réseau en salle.

> Projet en Phase 0 (socle technique). Les fonctionnalités arrivent phase par phase, voir la [roadmap](CLAUDE.md#roadmap).

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

`just` liste toutes les commandes : `test`, `lint`, `fmt`, `typegen`, `makemigrations`, `reset-db`…

## Architecture

Navigateur → Next.js (SSR + proxy `/api`) → API Django Ninja → PostgreSQL / Redis, avec un worker Celery.

Détails : `docs/architecture.md` et les décisions dans `docs/adr/` (à venir).

## Licence

Propriétaire, tous droits réservés. Voir [LICENSE](LICENSE).
