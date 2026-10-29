# ADR 0003 — Rendre les écritures de séance idempotentes dès la Phase 2, pour le hors-ligne

- **Statut** : proposé
- **Date** : 2026-10-29
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md, principe produit 2 : l'app « fonctionne hors ligne en salle et synchronise
ensuite ». La file d'attente hors ligne des séries (Serwist, TanStack Query) est prévue en
Phase 5, mais l'API des séances s'écrit en Phase 2. Le réseau en salle est souvent mauvais, et
la saisie d'une série doit prendre moins de 3 s (principe 1) : une requête qui échoue ou part
deux fois ne doit ni perdre ni dupliquer une série.

Si l'API attribue elle-même les identifiants, un envoi rejoué après une coupure crée un doublon,
car le client ne sait pas si le premier envoi a abouti. Il faudrait alors changer l'API et migrer
les données en Phase 5. La question se pose donc maintenant, avant le premier modèle de séance.

## Options envisagées

1. **Identifiants attribués par le serveur (POST classique), synchronisation en Phase 5.** C'est
   le plus simple aujourd'hui. Mais un POST rejoué crée un doublon ; la Phase 5 devrait ajouter
   une clé d'idempotence ou changer les identifiants, donc migrer les séances déjà saisies et
   modifier le client.
2. **POST avec en-tête `Idempotency-Key`** (le serveur garde la clé et la réponse un temps). Cela
   protège contre les doublons, mais demande un stockage des clés avec une durée de vie, et une
   série créée hors ligne n'a pas d'identifiant tant que le serveur n'a pas répondu : impossible
   de la modifier ou de la supprimer dans la file d'attente avant la synchronisation.
3. **Identifiants générés par le client (UUID) et `PUT` sur l'identifiant.** Le client crée la
   séance, l'exercice de séance et la série avec un UUID, puis envoie `PUT /…/{uuid}` : création
   si l'identifiant est nouveau, mise à jour sinon. Rejouer la même requête donne le même état.
   Une série a son identifiant définitif dès sa saisie, même hors ligne. Coût : l'API doit
   refuser un identifiant qui appartient déjà à un autre compte, et l'ordre des écritures compte
   (le parent avant l'enfant).

## Décision

Option 3. Les écritures de séance (`Workout`, `WorkoutExercise`, `Set`) se font par `PUT` sur un
UUID généré par le client, et la suppression est idempotente. La file d'attente reste en Phase 5,
et l'API n'aura pas à changer.

| Règle | Choix |
| --- | --- |
| Identifiant | UUID généré par le client (`crypto.randomUUID()`), clé primaire du modèle |
| Création ou mise à jour | `PUT /api/v1/<ressource>/{uuid}` : 201 à la création, 200 à la mise à jour, même corps de réponse |
| Identifiant d'un autre compte | 404 `problem+json`, comme une ressource absente : rien n'est écrit, et l'existence n'est pas confirmée |
| Suppression | `DELETE` idempotent : 204 même si la ressource n'existe plus (déjà supprimée) |
| Parent absent | 422 (`workout` inconnu pour une série) : la file d'attente rejoue dans l'ordre de saisie |
| Horodatage | `performed_at` fourni par le client (heure réelle de la série, hors ligne compris), `created_at` et `updated_at` posés par le serveur |
| Conflits | dernière écriture reçue gagne, champ par champ remplacé (`PUT` complet) ; un seul appareil saisit une séance en pratique |
| Effets dérivés | volume et records recalculés à chaque écriture, de façon déterministe : rejouer n'en crée pas de nouveaux |

## Conséquences

- ✅ Une série saisie sans réseau a son identifiant définitif tout de suite : la Phase 5 n'ajoute
  qu'une file d'attente côté client, sans migration ni changement d'API.
- ✅ Un double tap ou un envoi rejoué après une coupure ne crée jamais de doublon.
- ⚠️ Les tests d'isolation couvrent un cas de plus : `PUT` sur l'UUID d'une ressource d'un autre
  compte (404, rien d'écrit). C'est la règle « B ne lit jamais les données de A » appliquée aux
  écritures.
- ⚠️ Records et volume doivent être recalculés (pas incrémentés) : une série modifiée ou rejouée
  donne le même résultat. Testé explicitement.
- ⚠️ « Dernière écriture gagne » peut écraser une modification faite sur un autre appareil
  pendant une coupure. Accepté : une séance se saisit sur un seul téléphone. À revoir si la
  saisie à plusieurs appareils devient un besoin.
- 📋 PR « séances » (Phase 2) : modèles à clé primaire UUID, routes `PUT`/`DELETE`, tests de
  rejeu, d'isolation et d'ordre parent-enfant.
- 📋 Phase 5 : file d'attente Serwist et TanStack Query qui rejoue les `PUT` dans l'ordre de
  saisie.
