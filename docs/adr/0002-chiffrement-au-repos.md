# ADR 0002 — Chiffrer au repos les secrets et les champs sensibles avec Fernet

- **Statut** : proposé
- **Date** : 2026-10-28
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md impose le « chiffrement au repos des champs sensibles » (principe produit 5) et, pour
les jetons Basic-Fit, un stockage « chiffré en base (`django-cryptography` ou Fernet, clé en
variable d'environnement), jamais loggé ».

La MFA (TOTP, codes de secours, Phase 1) rend la question immédiate : allauth stocke le secret
TOTP et la graine des codes de secours dans `mfa.Authenticator.data`, et son adaptateur par
défaut les enregistre **en clair** (`DefaultMFAAdapter.encrypt` renvoie le texte tel quel,
vérifié dans le code d'allauth 65.20.1, `allauth/mfa/adapter.py`). Une fuite de la base (dump,
sauvegarde) suffirait alors à générer des codes valides pour chaque compte.

Le même mécanisme servira aux jetons Basic-Fit (Phase 4) et aux données de santé qui le
méritent (Phase 3) : il faut le choisir une fois.

## Options envisagées

1. **`django-cryptography`** (champs chiffrés transparents). Pratique dans les modèles, mais
   dernière version publiée en avril 2022 (vérifié sur PyPI) : un composant cryptographique
   non maintenu, sur un dépôt qui vise ASVS L2.
2. **Fernet de `cryptography`**, appelé explicitement là où il faut chiffrer. `cryptography`
   est déjà une dépendance (50.0.2, requise par la clé RS256 des JWT) : rien à ajouter. Fernet
   chiffre et authentifie (AES-128-CBC + HMAC-SHA256), et `MultiFernet` permet la rotation des
   clés. Inconvénient : pas de champ de modèle « magique », l'appel est explicite.
3. **Chiffrement du disque ou de PostgreSQL seulement** (TDE, volume chiffré). Nécessaire en
   prod, mais ne protège ni d'un dump SQL, ni d'une sauvegarde exportée, ni d'un accès
   applicatif en lecture : insuffisant seul.

## Décision

**Option 2** : un module `common/crypto.py` expose `encrypt`/`decrypt` sur un `MultiFernet` construit
à partir de la variable d'environnement `FIELD_ENCRYPTION_KEYS` (clés Fernet séparées par des
virgules, **la première chiffre**, toutes déchiffrent). Premier usage : `apps/accounts/mfa_adapter.py`
surcharge `encrypt`/`decrypt` de l'adaptateur MFA d'allauth.

| Environnement | Clé |
| --- | --- |
| prod | `FIELD_ENCRYPTION_KEYS` obligatoire (démarrage refusé sinon) |
| dev | celle de `.env` si définie, sinon une clé créée au premier démarrage dans un volume Compose partagé par `api` et `worker` (`devkeys`), conservée entre deux recréations |
| test | clé éphémère par exécution |
| CI / E2E | clé générée dans le job |

Rotation : ajouter la nouvelle clé **en tête** de la liste, redéployer, rechiffrer (commande à
écrire quand une rotation sera nécessaire), puis retirer l'ancienne.

## Conséquences

- ✅ Une fuite de la base seule ne donne plus accès aux secrets MFA ; la même brique servira aux
  jetons Basic-Fit et aux champs de santé, sans nouvelle dépendance.
- ✅ Fernet authentifie : une valeur altérée en base est refusée au déchiffrement au lieu d'être
  utilisée.
- ⚠️ **La clé perdue = les secrets perdus** : les utilisateurs devraient réactiver leur MFA. La
  clé de prod se sauvegarde avec le même soin que la base (hors du dépôt, hors des images).
- ⚠️ Les valeurs chiffrées ne se recherchent ni ne se trient en SQL : à réserver aux champs qui
  ne servent pas aux requêtes (secrets, jetons, notes libres), pas au poids ou à la taille, qui
  alimentent les calculs.
- ⚠️ **Risque résiduel** : avant l'activation, allauth garde le secret TOTP proposé dans la session
  Django (en base, non chiffrée) le temps de saisir le premier code ; il en est retiré à
  l'activation (testé). Un dump pris dans cet intervalle exposerait ce secret. Parade possible
  plus tard : sessions chiffrées (sérialiseur de session reposant sur ce module).
- ⚠️ Pas de rechiffrement automatique à la rotation : commande à prévoir avant la première
  rotation réelle.
- 📋 Actions :
  1. `common/crypto.py` + tests (aller-retour, rotation, refus d'une valeur altérée, clé invalide) ;
  2. `MFAAdapter` (encrypt/decrypt) et test qu'aucun secret TOTP n'est en clair en base ;
  3. `FIELD_ENCRYPTION_KEYS` dans `.env.example`, Compose, les settings et les workflows CI ;
  4. réutiliser ce module pour les jetons Basic-Fit (Phase 4) et les champs de santé retenus
     (Phase 3).
