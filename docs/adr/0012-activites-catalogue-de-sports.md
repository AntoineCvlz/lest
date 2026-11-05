# ADR 0012 — Activités : un catalogue de sports fixe, des métriques validées, des valeurs chiffrées

- **Statut** : accepté
- **Date** : 2026-11-04
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md prévoit un domaine `activities` pour « tout autre sport » que la musculation : type,
durée, distance, fréquence cardiaque moyenne, ressenti et « métriques libres (JSON validé par
schéma) ». Chaque sport a ses propres mesures : dénivelé pour la course, longueur du bassin et
nombre de longueurs pour la natation, rounds pour un sport de combat. La fréquence cardiaque
et le ressenti sont des données de santé ; les ADR 0007 et 0010 ont chiffré toutes les données
de santé saisies, avec des calculs en Python. Le tableau de bord de la Phase 4 lira ces
activités.

## Options envisagées

1. **Catalogue de sports fixe, défini dans le code.** Chaque sport déclare s'il a une distance
   et ses métriques (clé, unité, bornes) ; le serveur valide, le front construit le formulaire
   depuis `GET /api/v1/sports/`. Simple à valider et à agréger ; ajouter un sport demande une
   version de l'appli.
2. **Sports créés par l'utilisateur, avec leurs champs.** Souple, mais des schémas dynamiques à
   stocker, à valider et à afficher, et des agrégats incomparables d'un compte à l'autre.
3. **Métriques sans schéma** (JSON libre). Rien à maintenir, mais des données invérifiables,
   des fautes de frappe dans les clés et un tableau de bord impossible.

## Décision

**Option 1** (choix produit du 2026-11-04). Sports perso : plus tard, si le besoin apparaît.

| Sujet | Règle |
| --- | --- |
| Catalogue | `apps/activities/sports.py` : course, vélo, natation, marche, randonnée, aviron ou rameur, cardio sur machine, sport collectif, sport de raquette, sport de combat, escalade, yoga ou mobilité, autre ; clés stables en anglais, libellés français ; exposé par `GET /api/v1/sports/` |
| Métriques | entiers bornés propres au sport : dénivelé positif (m), longueur du bassin (m), longueurs, rounds, voies ; clé inconnue ou valeur hors bornes refusée (422, champs et codes seulement) ; distance refusée pour un sport sans distance |
| Activité | `Activity` : UUID du client (`PUT`/`DELETE` idempotents, ADR 0003), plusieurs par jour (20 au plus) ; en clair : date et sport (tri, période, contrainte en base) |
| Chiffré | durée (s), distance (m), fréquence cardiaque moyenne, ressenti (1 à 5, de « très mauvais » à « excellent »), métriques (JSON dans un `EncryptedTextField`) |
| Bornes | durée de 1 min à 24 h ; distance de 0 à 1 000 km ; fréquence cardiaque de 30 à 230 ; dates de 2000 à demain |
| Lecture | `GET /api/v1/activities/?start&end` : période bornée (366 jours au plus, 90 par défaut), même `Period` que le corps, déplacée dans `common.period` |
| Débit | `activities_write` 120 écritures par minute et par compte |
| RGPD | exportées en clair, supprimées en cascade avec le compte |

## Conséquences

- ✅ Des données comparables d'une semaine à l'autre : le tableau de bord additionne durées et
  distances par sport sans deviner les clés.
- ✅ Un dump révèle seulement quels jours une personne a pratiqué quel sport.
- ⚠️ Le sport reste en clair, comme le repas du journal (ADR 0010) : il indique une pratique,
  pas un état de santé ; le chiffrer empêcherait la contrainte en base sans rien protéger de
  plus utile.
- ⚠️ Ajouter un sport ou une métrique demande une PR : le catalogue est versionné avec le code,
  et une métrique retirée reste lisible dans les activités déjà saisies.
- 📋 PR `feat(activities)` back (catalogue, modèle, services, API, export) ; puis l'écran
  (journal des activités, formulaire construit depuis le catalogue) ; puis le tableau de bord.
