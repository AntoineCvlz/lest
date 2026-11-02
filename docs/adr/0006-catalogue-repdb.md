# ADR 0006 — Remplacer wger par RepDB pour le catalogue d'exercices et ses images

- **Statut** : accepté
- **Date** : 2026-11-02
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)
- **Remplace** : ADR 0004 (catalogue wger) et ADR 0005 (images wger normalisées)

## Contexte

Retour produit du 2026-11-02 sur les images de wger (ADR 0005) : styles mélangés (photos,
dessins, mannequins 3D), un tiers des exercices seulement illustré. Demande : un format unique,
une personne sur la machine, idéalement animé sur la fiche, à partir d'une banque **gratuite** ;
le catalogue wger existant peut être abandonné.

Vérifié le 2026-11-02 (dépôts, conditions d'utilisation, fichiers téléchargés) :

| Source | Homogène | Couverture | Licence | Verdict |
| --- | --- | --- | --- | --- |
| **RepDB, offre gratuite** (`github.com/RepDB/exercise-dataset`) | Oui : illustration en couleur, personnage sur la machine, fond uni | **701** exercices ; 516 en deux positions (départ, effort), 185 en une | Licence maison v1.0 : usage gratuit, commercial compris, **dans une application**, avec attribution | Retenu |
| Everkinetic | Oui (dessin au trait) | 269 exercices, deux positions | CC-BY-SA 4.0 | Moins complet, noir et blanc |
| ExerciseDB API, MuscleWiki API | Oui | Larges | Stockage des images interdit | Écartés (appel au tiers à chaque affichage, CSP, hors ligne) |
| Jeux « gratuits » de GIF (hasaneyldrm…) | Oui | Larges | Images d'un tiers (Gym Visual) sans droit transmis | Écartés |
| Banques payantes (WorkoutLabs, RepDB Standard) | Oui | Larges | Payantes | Hors budget pour l'instant |

Licence RepDB, points structurants (texte complet : `LICENSE-DATA.md` du dépôt RepDB) :

1. usage gratuit dans une application, y compris commerciale ;
2. lien visible « Exercise data by RepDB (repdb.co) » (crédits, README ou pied de page) ;
3. **pas de redistribution** du jeu de données, ni d'un dérivé, comme jeu de données, dépôt de
   données ou API ;
4. redimensionner, recadrer, recolorer pour l'application : permis ;
5. aucune utilisation des images par de l'IA générative ;
6. animations de l'offre payante (`premium-samples/`) : évaluation seulement.

Les images sont des œuvres générées par IA commandées par RepDB ; la base est protégée par le
droit sui generis des bases de données (allemand). Pas de noms français : anglais, allemand,
espagnol.

## Options envisagées

1. **Garder wger** (ADR 0004 et 0005) : licence libre, noms français, mais images hétérogènes
   et rares. Ne répond pas à la demande.
2. **wger pour les données, RepDB pour les images** : noms français conservés, mais
   correspondance d'exercices à maintenir entre deux bases, et la moitié du catalogue sans
   image. Complexe pour un résultat partiel.
3. **RepDB pour tout** : un seul référentiel cohérent, chaque exercice illustré dans le même
   style. Noms en anglais ; licence plus restrictive que CC-BY-SA, à respecter à la lettre.

## Décision

Option 3. RepDB devient l'unique source du catalogue et de ses images ; le catalogue wger, ses
images et les données d'entraînement qui en dépendent sont supprimés (aucune donnée de
production à ce jour : décision produit du 2026-11-02).

| Point | Règle |
| --- | --- |
| Source | Dépôt GitHub officiel de RepDB (désigné par RepDB comme distribution canonique) : `exercises.json`, puis les images référencées, depuis le même hôte, sans suivi de redirection (garde-fous de l'ADR 0005 conservés) |
| Rien dans notre dépôt | Ni `exercises.json`, ni images, ni traduction des noms : notre dépôt est public, un dérivé y serait « republié ». Les tests utilisent des exercices fictifs au même format |
| Noms | Anglais de RepDB (`lang="en"`), décision produit ; muscles, équipements et catégories traduits par nos propres libellés (notre vocabulaire, pas un dérivé) |
| Catégories | Partie du corps de RepDB, regroupée : abdominaux, bras, dos, mollets, pectoraux, jambes, épaules, corps entier ; cardio pour sa catégorie cardio |
| Images | Toutes les positions gardées (`start`, `peak`, `main`), réencodées en WebP 512 px sans métadonnées (rendu `FORMAT_VERSION` 2), servies par Lest (ADR 0005 : même origine, cache immuable) |
| Affichage | Vignette : départ (ou position unique) ; fiche : alternance départ ↔ effort, coupée par `prefers-reduced-motion` |
| Accès | Catalogue réservé aux comptes connectés (inchangé). Images servies sous un nom d'empreinte, non listables : rendu de nos écrans, pas une API de redistribution |
| Attribution | « Exercise data by RepDB (repdb.co) » sur la page Sources et licences, dans le README et le `LICENSE` |
| Mise à jour | Import mensuel (tâche existante), rejouable, exercices retirés désactivés |

## Conséquences

- ✅ Chaque exercice illustré, dans un style unique, avec le mouvement en deux temps.
- ✅ Un seul référentiel ; la correspondance wger ↔ images disparaît.
- ⚠️ Noms en anglais : traduction à rouvrir (hors dépôt, pour rester dans la licence).
- ⚠️ Licence maison, révocable en pratique par un changement de version : version 1.0
  consignée ici ; relue à chaque mise à jour du jeu. Alternative de secours : Everkinetic
  (CC-BY-SA), ou l'offre payante de RepDB (sans attribution, animations).
- ⚠️ Pas d'animations fluides (offre payante) : deux images alternées.
- ⚠️ Données d'entraînement de développement supprimées (migration) ; le seed les recrée.

📋 Actions :

1. PR back : passerelle `repdb`, modèles (identifiant RepDB, positions d'image), import,
   suppression de wger, seed, crédits, README, `LICENSE`.
2. PR front : catégories, alternance des positions sur la fiche, crédit RepDB.
