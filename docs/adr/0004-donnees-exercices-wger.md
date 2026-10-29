# ADR 0004 — Importer le catalogue d'exercices depuis wger, sous licence CC-BY-SA

- **Statut** : proposé
- **Date** : 2026-10-29
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md désigne l'API REST de wger (`/api/v2/exerciseinfo/`) comme source principale des
exercices, synchronisée par une commande `import_exercises`, avec une **attribution obligatoire
dans l'app**, et free-exercise-db (domaine public) en secours. La Phase 2 commence par ce
catalogue : la séance en cours en dépend.

Vérifié sur l'API publique de wger le 2026-10-29 (requêtes paginées sur `exerciseinfo`) :

| Mesure | Valeur |
| --- | --- |
| Exercices | 939 |
| Avec une traduction française | 584 (tous ont un nom anglais) |
| Licences | CC-BY-SA 4 : 781 ; CC-BY-SA 3 : 132 ; CC0 : 26 |
| Champs utiles | `uuid`, catégorie, muscles principaux et secondaires, équipements, traductions, licence, auteur (`license_author`), date de mise à jour |
| Avec images | 279 |

free-exercise-db (vérifié sur GitHub le même jour) : 876 exercices, Unlicense (domaine public),
maintenu, mais en anglais seulement et sans identifiant commun avec wger.

La licence CC-BY-SA impose deux obligations : **attribuer** (auteur, licence, lien, mention des
modifications) et **partager à l'identique** une base adaptée qu'on redistribue. Le code de Lest
reste propriétaire ; les données d'exercices dérivées de wger, elles, restent sous CC-BY-SA.

## Options envisagées

1. **wger, importé dans notre base.** Catalogue le plus riche, traduit en français aux deux
   tiers, mis à jour par sa communauté, avec un identifiant stable (`uuid`). Contraintes :
   attribution par exercice, partage à l'identique des données dérivées, dépendance à une API
   tierce (gérée par un import, jamais d'appel en direct pendant une séance).
2. **free-exercise-db seul.** Domaine public, donc aucune obligation. Mais tout est en anglais :
   il faudrait traduire 876 noms nous-mêmes et les maintenir, et aucun lien avec wger ne permet
   de récupérer ses traductions plus tard.
3. **Catalogue maison.** Contrôle total et noms français soignés, mais des centaines de fiches à
   écrire et à maintenir, pour un résultat moins complet.

## Décision

Option 1 : le catalogue est importé depuis wger dans nos tables, avec l'attribution de chaque
exercice, le nom français quand il existe et le nom anglais sinon. free-exercise-db reste le
secours si wger devient indisponible ou change de licence.

| Point | Choix |
| --- | --- |
| Import | commande `import_exercises`, rejouable sans doublon (clé : `uuid` de wger), et tâche Celery planifiée **chaque mois** par `beat` |
| Pendant une séance | aucun appel à wger : tout est lu dans notre base |
| Langue | nom français si wger en a un ; sinon nom anglais, marqué `lang="en"` dans l'interface (lecteurs d'écran) |
| Nom personnel | l'utilisateur peut renommer un exercice pour lui seul, sans modifier le catalogue |
| Attribution | auteur, licence et lien gardés par exercice ; page « Sources et licences » dans l'app, lien depuis chaque fiche |
| Partage à l'identique | les données d'exercices issues de wger restent sous leur licence ; mention dans la page des sources et dans `LICENSE` (le code reste propriétaire) |
| Exercice retiré par wger | gardé s'il sert déjà dans une séance (historique intact), masqué de la recherche |
| Images | non importées en Phase 2 : 279 exercices seulement en ont, chacune avec sa propre licence |
| Muscles | libellés français maison (wger fournit des noms latins et anglais) |
| Tests | réponses wger enregistrées en fixtures JSON (données publiques, licence citée), aucun appel réseau en CI |

## Conséquences

- ✅ Environ 940 exercices dès la Phase 2, dont 584 en français, avec catégories, muscles et
  équipements pour filtrer.
- ✅ Les séances ne dépendent jamais de la disponibilité de wger.
- ⚠️ Un tiers du catalogue s'affiche en anglais. Suivi : proposer des traductions à wger plus
  tard (elles reviendraient à l'import suivant), sans traduction maison à maintenir.
- ⚠️ Obligation juridique durable : toute redistribution du catalogue (export, API publique
  future) doit garder l'attribution et la licence CC-BY-SA. L'export RGPD ne contient que les
  séances de l'utilisateur, pas le catalogue.
- ⚠️ wger peut changer de format ou de licence. Suivi : l'import échoue de façon visible
  (journal, tâche en erreur) au lieu d'écrire des données partielles, et un test vérifie les
  licences acceptées (CC-BY-SA 3 et 4, CC0, CC-BY 4) ; toute autre licence est ignorée.
- 📋 PR « catalogue » : modèles exercice, muscle et équipement ; `import_exercises` et tâche
  mensuelle ; fixtures ; page « Sources et licences » côté front dans la PR « bibliothèque ».
- 📋 Mention de la licence des données dans `LICENSE` et dans le README.
