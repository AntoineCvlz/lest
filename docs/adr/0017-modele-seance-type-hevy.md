# ADR 0017 — Modèle de séance complet : types d'exercice et de série, supersets, routines, activités fusionnées

- **Statut** : accepté
- **Date** : 2026-11-18
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

Le 2026-11-18, le produit est recentré sur un carnet de musculation complet, avec l'ergonomie
des applications du genre (Hevy, Strong) : sans la partie communauté, en gardant la nutrition,
sans Basic-Fit (ADR 0016), avec la direction visuelle « Magnésie ». Les autres sports ne
restent pas à part : ils deviennent des exercices de la séance (choix produit).

Le modèle actuel (ADR 0003, Phase 2) ne sait pas représenter ce que l'écran de séance en
tableau doit afficher :

| Besoin | Modèle actuel |
| --- | --- |
| Exercices au poids du corps, lestés, assistés, en durée, en distance | Toute série a une charge (`weight_kg` obligatoire) et des répétitions |
| Séries dégressives, à l'échec | Un booléen `is_warmup` |
| Supersets | Aucun |
| Repos et note par exercice | Repos global côté front, pas de note |
| Exercices perso | Catalogue RepDB seul (ADR 0006), sans propriétaire |
| Routine avec charge et répétitions prévues **par série** | `target_sets × target_reps` par exercice |
| Course, vélo, natation dans la séance | App `activities` séparée (ADR 0012), champs chiffrés |
| Records autres que la charge (répétitions, durée, distance, volume d'une série) | Charge maximale et 1RM estimé seulement |

Contraintes de CLAUDE.md qui s'appliquent : écritures idempotentes à UUID client (ADR 0003),
file hors ligne (ADR 0015), données de santé chiffrées (ADR 0007, 0012), isolation stricte
entre comptes, unités SI en base, volume hors échauffement.

## Options envisagées

1. **Une table par type de série** (charge, durée, distance) : contraintes strictes en base,
   mais chaque lecture (historique, « Précédent », records, export) fait des unions, et le
   front doit traiter trois formes.
2. **Une table `Set` à colonnes facultatives, le type porté par l'exercice** : une seule forme
   de série, des colonnes vides selon le type, la cohérence vérifiée par le service. C'est la
   forme retenue par les applications du genre, et la plus simple pour la file hors ligne.
3. **Valeurs en JSON** (`{"kg": 80, "reps": 8}`) : souple, mais plus de contrôle en base, des
   agrégats SQL (volume, records) impossibles, des schémas à versionner.

Pour les activités :

- **A. Garder l'app `activities`** : contraire au choix produit.
- **B. Recopier chaque activité en séance terminée**, avec un exercice de cardio de Lest par
  sport : une seule histoire d'entraînement, un seul écran.

## Décision

**Option 2 et option B.** Une seule forme de série à colonnes facultatives ; le type
d'exercice dit lesquelles sont attendues ; les activités deviennent des séances.

### Types d'exercice (`Exercise.kind`)

| Type | Colonnes de la série | Exemples |
| --- | --- | --- |
| `weight_reps` | charge, répétitions | développé couché |
| `reps` | répétitions | pompes, tractions |
| `weighted_reps` | lest ajouté, répétitions | dips lestés |
| `assisted_reps` | assistance (retirée), répétitions | tractions assistées |
| `duration` | durée | gainage |
| `distance_duration` | distance, durée | course, rameur, natation |
| `weight_distance` | charge, distance | marche du fermier |

Le type est fixé à l'import RepDB (correspondance de l'équipement et de la catégorie,
`weight_reps` par défaut, revue à la main sur les exercices de cardio et au poids du corps)
et à la création d'un exercice perso. Il ne change plus ensuite (l'historique en dépend).

### Séries (`Set`)

- `weight_kg`, `reps`, `duration_s`, `distance_m` deviennent **facultatifs** ; le service
  exige exactement les colonnes du type de l'exercice (422 `invalid_for_kind` sinon). Bornes
  inchangées pour la charge et les répétitions ; durée ≤ 24 h, distance ≤ 1 000 km.
- `is_warmup` est remplacé par `set_type` : `warmup`, `normal`, `drop` (dégressive),
  `failure` (à l'échec). Migration : `is_warmup = true` → `warmup`, sinon `normal`.
- Volume = Σ charge × répétitions des séries **hors échauffement**, pour les types à charge
  (`weight_reps`, `weighted_reps` compte le lest seul, `weight_distance` exclu du volume).
- Pas de chiffrement des séries (comme aujourd'hui) : la durée et la distance d'une course
  rejoignent le niveau de sensibilité d'une charge soulevée. La fréquence cardiaque et le
  ressenti restent chiffrés (ci-dessous).

### Séance et exercices de séance

- `Workout.name` (80 caractères, nom de la routine ou « Séance »), `Workout.note` et
  `WorkoutExercise.note` : texte libre, **chiffré** (`EncryptedTextField`, ADR 0007) parce
  qu'un utilisateur y écrira une douleur ou un traitement.
- `WorkoutExercise.rest_seconds` (15 à 600, vide = réglage du profil
  `Profile.default_rest_seconds`, 120 par défaut).
- `WorkoutExercise.superset` : petit entier facultatif. Des exercices **consécutifs** portant la
  même valeur forment un superset ; le service le vérifie (pas de superset troué).
- `Workout.avg_heart_rate` et `Workout.feeling` (chiffrés, facultatifs) : repris des activités,
  proposés à la fin de toute séance.

### Exercices perso

- `Exercise.owner` facultatif : vide pour le catalogue, le compte pour un exercice perso.
  Identifiant UUID du client (ADR 0003, création hors ligne), `PUT` idempotent.
- Nom en français (`name_language = fr`), type, catégorie, muscle principal, muscles
  secondaires et équipement facultatifs ; pas d'image (tuile de catégorie). 300 par compte.
- **Isolation** : un compte voit le catalogue et ses exercices ; l'exercice perso d'un autre
  compte répond 404, partout (catalogue, séance, routine, historique, records). Testé par
  endpoint.
- Suppression : refusée (409 `in_use`) si une séance ou une routine l'utilise ; il peut être
  archivé (`is_active = false`), comme le catalogue.

### Routines (ex-programmes)

Dans l'interface, `Program` devient un **dossier** et `ProgramDay` une **routine** ; les
modèles gardent leur nom (pas de migration de renommage, routes inchangées).

- `ProgramExercise.target_sets` / `target_reps` sont remplacés par des **séries prévues**
  (`ProgramSet` : position, `set_type`, charge, répétitions, durée, distance, toutes
  facultatives selon le type), plus `rest_seconds`, `superset` et `note`. Migration : N séries
  `normal` de `target_reps` répétitions, sans charge.
- Démarrer une routine recopie exercices **et séries prévues** (la recopie de l'ADR 0003
  continue, identifiants dérivés par SHA-256 comme `copiedExerciseId`).
- En fin de séance, « Mettre à jour la routine » réécrit ses séries prévues avec celles faites
  (proposé seulement si elles diffèrent ; jamais automatique).
- Plafonds : 50 routines par dossier, 20 exercices par routine, 20 séries prévues par exercice.

### « Précédent »

Lecture, pas de stockage : pour chaque exercice de la séance, les séries de la **dernière
séance terminée** qui contenait cet exercice, par position. Une route
`GET /api/v1/exercises/{id}/last-sets/`, gardée dans la copie hors ligne (ADR 0015).

### Records

`PersonalRecord.value_kg` devient `value` (décimal, unité selon le type de record) ; types de
record : charge maximale, 1RM estimé (existants), **volume d'une série**, **répétitions
maximales** (types sans charge), **durée la plus longue**, **distance la plus longue**.
Toujours reconstruits sous le verrou du compte, séries de travail seulement.

### Fusion des activités

1. Un exercice de cardio **de Lest** (sans propriétaire, `source_id` préfixé `lest:`, nom
   français, type `distance_duration` ou `duration`) par sport du catalogue de l'ADR 0012.
2. Recopie : chaque activité devient une séance terminée (début = date à midi,
   heure locale ; fin = début + durée), un exercice, une série `normal` ; fréquence cardiaque
   et ressenti vers la séance ; les métriques propres au sport (dénivelé, longueurs, rounds)
   vers la note de l'exercice, en clair dans le texte chiffré (« Dénivelé : 320 m »).
   Identifiants dérivés de celui de l'activité (SHA-256, format v4) : rejouable sans doublon.
   *Précisé à l'implémentation (PR 5)* : la recopie passe par les services de `training`
   (records reconstruits, verrou du compte), ce qu'une migration ne peut pas faire avec ses
   modèles historiques. Elle a donc lieu à chaque écriture d'une activité (suppression
   comprise) tant que l'app existe, et la commande `copy_activities` rattrape les activités
   plus anciennes (`--check` : échoue s'il en reste une sans séance). La distance d'une série
   `distance_duration` devient facultative : 22 des 35 activités de la base de dev n'en ont
   pas (tapis, séance sans montre).
3. Le Bilan (ADR 0013) lit les séances au lieu des activités : par semaine, nombre de séances,
   durée et distance des séries de travail.
4. L'app `activities`, ses routes et sa table sont supprimées dans une PR **suivante**, une
   fois la copie vérifiée sur la base de dev (`copy_activities --check`).

## Écart à CLAUDE.md

- La table des domaines liste `activities` (SportType, Activity) : le domaine disparaît, ses
  données passent dans `training`. CLAUDE.md sera mis à jour par la PR qui supprime l'app.
- Le produit cite « tout autre sport via un modèle d'activité générique » : il devient « tout
  autre sport via des exercices de durée et de distance dans la séance ».

## Conséquences

- ✅ Un seul écran et une seule histoire d'entraînement ; la saisie en tableau (« Précédent »,
  coche, types de série, supersets) devient possible ; les exercices perso couvrent les
  machines de salle absentes de RepDB.
- ✅ Les écritures restent idempotentes et compatibles avec la file hors ligne : de nouvelles
  colonnes dans les mêmes `PUT`, pas de nouvelle forme de requête.
- ⚠️ Cohérence type ↔ colonnes vérifiée par le service, pas par la base (un `CHECK` ne voit pas
  le type de l'exercice) : tests des services sur chaque type, et la route est le seul chemin
  d'écriture.
- ⚠️ Migration des activités : métriques par sport aplaties en texte (plus de calcul possible
  sur le dénivelé) ; fréquence cardiaque au niveau de la séance seulement.
- ⚠️ Contrat d'API modifié (séries, routines, records) : client typé régénéré, copie hors
  ligne invalidée par le changement de schéma (`buster`), saisies en file d'un ancien format
  refusées en 422 et annoncées (ADR 0015). Acceptable : un seul utilisateur aujourd'hui.
- ⚠️ Export RGPD : nouveaux champs à exporter (notes déchiffrées, exercices perso, séries
  prévues).
- 📋 PR, dans l'ordre :
  1. `Exercise.kind` + exercices perso (back, isolation, import RepDB) ;
  2. séries : colonnes facultatives, `set_type`, validation par type, records élargis ;
  3. séance : nom, notes chiffrées, repos, superset, FC et ressenti ; « Précédent » ;
  4. routines : séries prévues, recopie, « Mettre à jour la routine » ;
  5. exercices de cardio de Lest et migration des activités ; Bilan sur les séances ;
  6. suppression de l'app `activities` ; CLAUDE.md ;
  7. front : écran de séance en tableau (« Magnésie »), puis routines, exercices perso, fiche
     d'exercice et statistiques.
