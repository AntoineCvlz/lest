# ADR 0007 — Chiffrer les mesures corporelles et calculer leurs tendances en Python

- **Statut** : accepté
- **Date** : 2026-11-03
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

La Phase 3 ajoute l'app `body` : poids quotidien avec moyenne mobile sur 7 jours, puis
mensurations et photos. CLAUDE.md impose la « minimisation, chiffrement au repos des champs
sensibles » (principe produit 5) et l'ADR 0002 a choisi Fernet (`common/crypto.py`, clés
`FIELD_ENCRYPTION_KEYS` avec rotation) en annonçant son usage pour « les données de santé qui
le méritent ».

Le poids et les mensurations sont des données de santé : une courbe de poids datée suffit à
révéler un régime, une grossesse ou une maladie. Les charges de musculation (Phase 2) restent en
clair : elles décrivent une performance, pas l'état du corps.

Chiffrer un nombre interdit à PostgreSQL de le trier, de le borner (`CheckConstraint`) et de
l'agréger : la décision porte donc aussi sur l'endroit où se font les calculs.

## Options envisagées

1. **Mesures en clair, chiffrement du disque en prod.** Agrégats SQL et contraintes en base
   possibles. Mais un dump, une sauvegarde exportée ou un accès en lecture à la base livre la
   courbe de poids de chaque compte : c'est précisément ce que l'ADR 0002 veut éviter.
2. **Mesures chiffrées (Fernet), calculs en Python.** Seule la date reste en clair (tri, unicité,
   période demandée). Volume faible : au plus une pesée par jour, quelques centaines de lignes
   par an et par compte, déchiffrées pour la période affichée. Bornes vérifiées par le service.
3. **Chiffrement côté client (clé dérivée du mot de passe).** Protège même d'un serveur
   compromis, mais casse la réinitialisation du mot de passe, les passkeys, l'export et les
   futures analyses (`insights`) : hors de proportion pour le MVP.

## Décision

**Option 2** (choix produit du 2026-11-03) : les valeurs des mesures corporelles (poids,
mensurations, notes) sont chiffrées par un champ de modèle maison, `common.fields.EncryptedDecimalField`,
qui appelle `common.crypto` à l'écriture et à la lecture. Moyenne mobile et courbes sont
calculées en Python sur la période demandée.

| Sujet | Règle |
| --- | --- |
| En clair | propriétaire, date de la mesure, dates techniques |
| Chiffré | valeur (kg, m), notes libres |
| Unicité | une pesée par compte et par jour (`UniqueConstraint`) |
| Bornes | vérifiées par le service (20 à 400 kg), la base ne lit pas la valeur |
| Moyenne mobile | moyenne des pesées des 7 derniers jours (jour compris), sur les jours pesés seulement |
| Lecture | par période bornée (366 jours au plus) plutôt que par curseur |

### Écart assumé : clé naturelle plutôt qu'un UUID client (ADR 0003)

Une pesée est unique par jour : `PUT /api/v1/body-weights/{date}/` est idempotent par nature et
se rejoue hors ligne sans identifiant à générer. Deux appareils qui saisissent le même jour
convergent vers la dernière écriture, ce qui est le comportement attendu (une correction
remplace la valeur). Les mensurations suivront la même règle ; les photos, multiples par jour,
garderont un UUID client.

### Écart assumé : période plutôt que curseur (CLAUDE.md, API)

La courbe a besoin de toutes les pesées d'une période et des 6 jours qui la précèdent (moyenne
mobile). Une période bornée (`start`, `end`, de 2000 à demain, 366 jours au plus) joue le rôle du curseur : réponse
de taille bornée, sans pagination à recoller côté client.

## Conséquences

- ✅ Un dump de la base ne révèle ni poids ni mensurations ; rotation des clés commune avec les
  secrets MFA (ADR 0002).
- ✅ Le champ chiffré est réutilisable (mensurations, puis jetons Basic-Fit).
- ⚠️ Pas de tri, de filtre ni d'agrégat SQL sur les valeurs : toute analyse future (`insights`)
  déchiffre en Python. Les filtres lèvent une erreur, mais `order_by` et `Max`/`Min` comparent
  les jetons et rendent un résultat **faux sans erreur** : règle de revue, écrite dans le champ. Acceptable aux volumes visés ; à revoir si une analyse multi-comptes
  apparaît (elle ne devrait pas : données personnelles).
- ⚠️ Bornes non garanties par la base : un test vérifie que le service refuse les valeurs hors
  plage, et le champ refuse d'écrire autre chose qu'un décimal.
- ⚠️ La taille d'un jeton Fernet varie un peu avec la longueur du texte : la valeur est
  formatée à précision fixe avant chiffrement pour ne rien en laisser deviner.
- ⚠️ Pas encore de commande de rechiffrement après rotation (ADR 0002) : les anciennes clés
  restent actives tant qu'elle n'existe pas. À écrire avant le premier déploiement.
- 📋 PR `feat(body)` : champ `EncryptedDecimalField`, app `body` (pesées, API, export RGPD),
  limite `body_write` ; puis écran Poids (courbe SVG maison, tableau accessible).
