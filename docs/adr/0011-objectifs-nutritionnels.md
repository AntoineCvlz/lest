# ADR 0011 — Proposer des objectifs nutritionnels calculés, modifiables, à partir de données chiffrées

- **Statut** : proposé
- **Date** : 2026-11-04
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md prévoit des « objectifs kcal/macros (Mifflin-St Jeor + surplus) » et ne demande
« sexe, âge et activité » qu'avec ces objectifs (Phase 1, minimisation). Le choix produit du
2026-11-03 est un **calcul proposé, modifiable** plutôt qu'une saisie manuelle seule.

Mifflin-St Jeor demande le poids, la taille, l'âge et une constante qui dépend du sexe. Le
poids vit dans `body` (chiffré, ADR 0007), la taille et l'objectif dans le profil (`accounts`).
Sexe et date de naissance sont des données personnelles sensibles ; le niveau d'activité, une
donnée de mode de vie.

## Options envisagées

1. **Champs ajoutés au profil (`accounts`), en clair.** Simple, mais le profil serait chargé de
   données inutiles tant que les objectifs ne sont pas activés, et lisibles dans un dump.
2. **Un `NutritionTarget` par compte dans `nutrition`, données chiffrées, créé à l'activation.**
   Minimisation (rien n'existe avant), même chiffrement que le journal (ADR 0010). Le calcul
   lit le poids et le profil par leurs sélecteurs (aucun import croisé de modèles).
3. **Calcul côté navigateur, rien en base.** Aucune donnée stockée, mais des objectifs
   différents d'un appareil à l'autre, et rien pour les analyses de la Phase 4.

## Décision

**Option 2.**

| Sujet | Règle |
| --- | --- |
| Données | sexe retenu pour la formule (`male`, `female`), date de naissance, activité (`sedentary` 1,2, `light` 1,375, `moderate` 1,55, `active` 1,725, `very_active` 1,9) : chiffrées (`EncryptedTextField`) |
| Calcul | `targets.compute` (pur, testé) : Mifflin-St Jeor × activité × objectif du profil (prise de masse + 10 %, maintien, sèche - 20 %), arrondi à 10 kcal ; protéines 2 g/kg, lipides 0,9 g/kg, glucides pour le reste (jamais négatifs) ; poids : dernière pesée |
| Surcharge | chaque objectif (kcal, protéines, glucides, lipides) peut être saisi à la main, chiffré ; une valeur saisie remplace la valeur calculée, les autres restent calculées |
| Manques | sans profil ou sans pesée : pas de valeur calculée, `missing` le dit ; des objectifs tous saisis à la main restent utilisables |
| Bornes | âge de 14 à 100 ans ; kcal de 1 000 à 8 000 ; protéines ≤ 500 g, glucides ≤ 1 000 g, lipides ≤ 400 g |
| API | `GET` et `PUT /api/v1/nutrition/targets/` (idempotent) : données, valeurs calculées, valeurs retenues, manques |
| RGPD | exporté en clair, supprimé avec le compte |

## Conséquences

- ✅ Rien n'est demandé ni stocké tant que l'utilisateur n'active pas ses objectifs.
- ✅ Les objectifs suivent le poids (dernière pesée) sans resaisie.
- ⚠️ La formule de Mifflin-St Jeor ne connaît que deux constantes : l'écran présente le choix
  comme « formule de calcul », pas comme une identité, et laisse surcharger les résultats.
- ⚠️ Une estimation, pas un avis médical : l'écran le dit.
- 📋 PR `feat(nutrition)` back ; puis l'écran (objectifs dans le profil, progression sur
  l'écran Repas).
