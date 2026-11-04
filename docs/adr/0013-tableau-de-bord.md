# ADR 0013 — Tableau de bord : lectures agrégées par les sélecteurs des domaines, en une route

- **Statut** : proposé
- **Date** : 2026-11-04
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md prévoit un domaine `insights` sans table propre : poids contre objectif, volume
hebdomadaire par groupe musculaire, progression, adhérence nutrition. Choix produit du
2026-11-04 : le tableau de bord devient l'accueil (`/`, onglet « Bilan ») et montre quatre
blocs : poids et objectif, activité de la semaine, adhérence nutrition, volume par muscle.

Contraintes : aucun import croisé de modèles entre domaines ; poids, repas et activités sont
chiffrés (ADR 0007, 0010, 0012), donc additionnés en Python ; séries de musculation en clair,
agrégeables en base ; aucune donnée d'un autre compte.

## Options envisagées

1. **Une route `GET /api/v1/insights/dashboard/`** qui appelle un sélecteur par domaine
   (`training`, `body`, `nutrition`, `activities`, `accounts`) et renvoie les quatre blocs.
   Un seul aller-retour pour l'écran d'accueil ; chaque domaine garde ses calculs.
2. **Une route par bloc.** Chargement indépendant, mais quatre requêtes à chaque ouverture et
   autant de limites et de tests d'isolation.
3. **Table de résumés recalculée par Celery.** Lecture instantanée, mais une copie de données de
   santé à chiffrer, à invalider à chaque écriture et à purger.

## Décision

**Option 1.** Calcul à chaque lecture, sur des fenêtres courtes (12 semaines au plus).

| Bloc | Règle |
| --- | --- |
| Poids | moyenne sur 7 jours (ADR 0007) aujourd'hui, il y a 4 et 12 semaines ; rythme en kg par semaine sur 4 semaines ; repère selon l'objectif du profil : prise de masse de +0,1 à +0,5 kg/sem, maintien de −0,2 à +0,2, sèche de −1,0 à −0,2 (« repère, pas un avis médical ») |
| Activité | 8 semaines (lundi à dimanche, heure locale) : séances de musculation terminées et leur durée, activités des autres sports, leur durée et leur distance |
| Nutrition | 7 et 28 jours **avant aujourd'hui** (journée en cours exclue), jours notés seulement : jours à ±10 % de l'objectif d'énergie, jours à 90 % au moins de l'objectif de protéines ; sans objectifs activés, le bloc le dit |
| Volume | 8 semaines, séries de travail seulement (CLAUDE.md) : par muscle **principal** de l'exercice, séries et volume (poids × reps) ; un exercice à deux muscles principaux compte pour chacun |
| Sélecteurs | `training.selectors.weekly_training`, `nutrition.selectors.daily_totals`, puis ceux qui existent (`list_weights`, `list_activities`, `targets_view`, `get_profile`) |
| API | `GET /api/v1/insights/dashboard/`, compte connecté, aucune donnée d'un autre compte |

## Conséquences

- ✅ Un seul appel pour l'accueil ; aucune nouvelle donnée stockée, rien à chiffrer ni à exporter.
- ✅ Les règles de chaque domaine restent chez lui (volume hors échauffement, moyenne mobile).
- ⚠️ Coût : environ 3 000 entrées de journal et quelques centaines de séries déchiffrées ou lues
  par ouverture au pire ; à mesurer si le tableau de bord ralentit (cache par compte ensuite).
- ⚠️ Les repères de rythme sont des ordres de grandeur génériques ; l'écran les présente comme
  tels.
- 📋 PR `feat(insights)` back ; puis l'écran (accueil « Bilan », graphiques en SVG maison avec
  résumé texte et tableau, sans nouvelle dépendance).
