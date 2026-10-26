# Politique de sécurité

Lest manipule des données de santé (poids, mensurations, photos, alimentation). La sécurité et la confidentialité de ces données sont prioritaires.

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique.** Utilisez le signalement privé de GitHub : onglet **Security → Report a vulnerability** du dépôt.

Merci d'indiquer :

- la description du problème et son impact potentiel ;
- les étapes de reproduction (version, environnement, requêtes) ;
- toute preuve de concept, **sans accéder aux données d'autres utilisateurs** au-delà du strict nécessaire pour démontrer le problème.

## Engagements

| Étape | Délai cible |
| --- | --- |
| Accusé de réception | 72 h |
| Première évaluation (sévérité, périmètre) | 7 jours |
| Correctif pour une sévérité haute ou critique | 30 jours |

Une divulgation coordonnée est convenue avec la personne ayant signalé le problème ; elle est créditée si elle le souhaite.

## Périmètre

- Inclus : le code de ce dépôt (API Django, front-end Next.js, configuration Docker et CI).
- Exclus : les services tiers (Basic-Fit, Open Food Facts, wger), les attaques par déni de service, l'ingénierie sociale.

## Versions supportées

Le projet est en développement actif : seule la branche `main` reçoit des correctifs de sécurité.

## Référentiel

Les exigences de sécurité suivent l'OWASP ASVS niveau 2. Voir `CLAUDE.md` pour les mesures applicatives et la chaîne CI.
