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

_À compléter en fin de Phase 0 (démarrage en 3 commandes)._

## Architecture

Navigateur → Next.js (SSR + proxy `/api`) → API Django Ninja → PostgreSQL / Redis, avec un worker Celery.

Détails : `docs/architecture.md` et les décisions dans `docs/adr/` (à venir).

## Licence

Propriétaire, tous droits réservés. Voir [LICENSE](LICENSE).
