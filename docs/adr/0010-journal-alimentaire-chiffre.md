# ADR 0010 — Chiffrer le journal alimentaire en entier, aliment recopié à la saisie

- **Statut** : proposé
- **Date** : 2026-11-03
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

Le journal des repas dit ce qu'une personne mange, en quelle quantité et quand : c'est une
donnée de santé (régime, troubles alimentaires, religion, grossesse…). CLAUDE.md impose le
chiffrement au repos des champs sensibles ; l'ADR 0007 a chiffré poids et mensurations, avec
des calculs en Python. Les aliments (ADR 0009) sont des données communes, en clair, mais un
aliment perso peut être modifié ou supprimé, et une fiche Open Food Facts corrigée : un
historique qui pointerait vers l'aliment changerait après coup.

## Options envisagées

1. **Tout chiffrer, référence de l'aliment comprise.** Un dump ne révèle ni ce qui est mangé
   ni combien ; en clair restent la date et le repas. « Aliments récents » et totaux se
   calculent en Python (quelques dizaines de lignes par jour).
2. **Quantités chiffrées, référence de l'aliment en clair (clé étrangère).** Statistiques
   simples en SQL, mais un dump révèle quels aliments chaque compte mange, et quand.
3. **Journal en clair**, comme les séances de musculation : tout le régime lisible dans un dump.

## Décision

**Option 1** (choix produit du 2026-11-03).

| Sujet | Règle |
| --- | --- |
| Entrée | `JournalEntry` : UUID du client (`PUT`/`DELETE` idempotents, ADR 0003), date et repas (`breakfast`, `lunch`, `dinner`, `snack`) en clair |
| Chiffré | référence de l'aliment (texte, pas de clé étrangère), nom, quantité en grammes, valeurs pour 100 g |
| Copie | l'aliment est recopié à la saisie, et quand l'entrée change d'aliment ; une nouvelle quantité garde la copie : l'historique ne suit pas les corrections de l'aliment |
| Texte chiffré | `common.fields.EncryptedTextField` : complété par blocs de 64 octets avant chiffrement, la longueur du jeton ne trahit pas celle du nom |
| Calculs | valeurs de l'entrée (valeur pour 100 g × grammes), totaux du jour, « aliments récents » (300 dernières entrées relues) : en Python ; une valeur inconnue compte 0 |
| Eau | `WaterIntake` : un total par compte et par jour, chiffré, `PUT /api/v1/water/{date}/` |
| Bornes | 0 < grammes ≤ 5 000 ; 100 entrées par jour ; eau de 0 à 10 l ; dates de 2000 à demain |
| RGPD | journal et eau exportés en clair, supprimés en cascade avec le compte |

## Conséquences

- ✅ Le régime d'un compte n'est lisible qu'avec la clé ; même modèle de menace que l'ADR 0007.
- ✅ Un aliment perso supprimé ou une fiche OFF corrigée ne réécrit pas l'historique.
- ⚠️ Aucune requête SQL sur le contenu du journal : les analyses (`insights`, Phase 4)
  déchiffrent en Python ; à surveiller si l'on veut des tendances sur des années.
- ⚠️ « Aliments récents » relit les 300 dernières entrées à chaque appel : quelques
  millisecondes aujourd'hui, à mettre en cache par compte si besoin.
- 📋 PR `feat(nutrition)` : modèles, services, routes, tests ; puis l'écran du journal.
