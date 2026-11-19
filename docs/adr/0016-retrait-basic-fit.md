# ADR 0016 — Retirer l'intégration Basic-Fit

- **Statut** : accepté
- **Date** : 2026-11-18
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

L'ADR 0014 a relié Basic-Fit par le paquet non officiel `basicfit` (1.0.0, un mainteneur, sans
provenance PyPI), derrière un adaptateur et le drapeau `BASICFIT_ENABLED`, désactivé par défaut.
Elle gardait le club principal, les visites et le poids des balances de club.

Le 2026-11-18, le produit est recentré sur un carnet de musculation complet (séance, routines,
statistiques) avec la nutrition. Basic-Fit n'en fait plus partie. Garder l'intégration coûte :

- un paquet sans provenance, relu à chaque version, épinglé par hash et exclu de Dependabot ;
- des jetons de l'application Basic-Fit chiffrés en base (rotation à chaque appel, risques
  listés dans l'ADR 0014) ;
- une tâche horaire, trois limites de débit, une section du profil, un export RGPD.

## Options envisagées

1. **Garder l'intégration désactivée** : rien à migrer, mais tous les coûts ci-dessus restent,
   pour une fonction que personne n'utilise.
2. **Tout retirer, garder les pesées des balances** : moins de code, mais des pesées d'une source
   qui n'existe plus, et un champ `source` qui ne sert qu'à elles.
3. **Tout retirer, pesées des balances comprises** : choix du produit.

## Décision

Option 3 : l'app `integrations/basicfit`, le paquet et toutes les données venues de Basic-Fit
sont supprimés.

| Élément | Traitement |
| --- | --- |
| Pesées `source = basicfit` | Supprimées par `body/0005_remove_basicfit` ; les saisies manuelles restent |
| Champ `BodyWeight.source` et sa contrainte | Supprimés (une seule source désormais) |
| Tables `basicfit_connection`, `basicfit_visit`, `basicfit_pendinglogin` | Supprimées (`DROP TABLE IF EXISTS`) : jetons chiffrés, visites, connexions en cours |
| Types de contenu `basicfit` | Supprimés (leurs permissions suivent) |
| Paquets `basicfit` et `aiohttp` | Retirés (`aiohttp` ne servait qu'à lui) |
| Route, tâche `basicfit-sync`, limites `basicfit_*`, `BASICFIT_ENABLED` | Retirés |
| Front : section du profil, mention « balance Basic-Fit » | Retirés |

La migration est irréversible : elle ne recrée ni les tables ni les données.

## Conséquences

- ✅ Plus de dépendance sans provenance ni de jeton tiers en base ; surface d'attaque réduite
  (route d'URL de redirection, appels sortants vers une API non officielle).
- ✅ Export RGPD et suppression de compte plus simples.
- ⚠️ Les jetons Basic-Fit ne sont pas révoqués chez Basic-Fit (impossible, ADR 0014) : ils sont
  effacés de notre base, et expirent chez eux.
- ⚠️ Un compte qui voudrait ses visites ou pesées de balance doit les exporter avant la
  migration : sans utilisateur hors du développeur, aucune action.
- 📋 PR `refactor: remove the Basic-Fit integration` ; ADR 0014 passe à « remplacé par ADR
  0016 » ; CLAUDE.md, README, architecture et SECURITY à jour ; `BASICFIT_ENABLED` à retirer de
  `.env.example` et de `.env` (fichiers modifiés à la main, hors des outils de Claude Code).
