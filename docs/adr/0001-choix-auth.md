# ADR 0001 — Authentifier par JWT `django-allauth` derrière un proxy Next.js (BFF)

- **Statut** : accepté
- **Date** : 2026-10-26
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

Lest manipule des données de santé (poids, mensurations, photos, alimentation). Le cahier des
charges (CLAUDE.md) impose :

- des **JWT** avec access court (5–15 min), refresh long (7–30 j), **rotation** du refresh et
  **révocation** de l'ancien ;
- des jetons **jamais lisibles par le JavaScript** du navigateur (pas de `localStorage`, pas de
  jeton dans un corps de réponse reçu par le navigateur) ;
- un proxy Next.js qui **rafraîchit sur 401 et rejoue la requête une seule fois**, avec un verrou
  contre les refresh concurrents ;
- les parcours de compte : inscription, connexion, déconnexion, réinitialisation, **MFA TOTP**,
  **passkeys** ;
- une future **app native** qui recevra son refresh en stockage sécurisé (Keychain/Keystore).

L'API est en **Django Ninja** (décision de Phase 0). Les solutions habituelles du monde DRF
(`dj-rest-auth`, `djangorestframework-simplejwt`) **dépendent de DRF** : vérifié sur PyPI,
`djangorestframework-simplejwt` 5.5.1 exige `djangorestframework>=3.14`.

## Options envisagées

1. **simplejwt + endpoints Ninja écrits à la main.** Réutilise une brique connue, mais embarque
   DRF pour ses seules classes de jetons, et laisse à écrire *tous* les parcours de compte (reset,
   MFA, passkeys), soit beaucoup de code de sécurité maison.
2. **`django-ninja-jwt`** (portage de simplejwt pour Ninja). Pas de DRF, mais dépend de
   `django-ninja-extra` (un second framework par-dessus Ninja), et ne couvre pas non plus les
   parcours de compte.
3. **Sessions Django (cookie `sessionid`) + CSRF via le proxy**, sans JWT. Le plus simple et très
   robuste pour un navigateur sur la même origine, mais contraire au cahier des charges et sans
   réponse directe pour l'app native.
4. **`django-allauth` en mode *headless*, stratégie JWT native**, consommée par un proxy
   Next.js qui garde les jetons côté serveur (*Backend for Frontend*). ✅

## Décision

**Option 4.** `django-allauth` (≥ 65.20, épinglé) fournit, maintenus et audités par une large
communauté : inscription, connexion, vérification d'e-mail, réinitialisation, limitation de débit,
MFA TOTP et passkeys (`allauth.mfa`), et une stratégie JWT dont le code source a été lu :

| Exigence | allauth headless JWT | Réglage |
| --- | --- | --- |
| Access court | `JWT_ACCESS_TOKEN_EXPIRES_IN` (défaut 300 s) | **300 s** |
| Refresh long | `JWT_REFRESH_TOKEN_EXPIRES_IN` (défaut 1 j) | **14 j** |
| Rotation + révocation de l'ancien | `JWT_ROTATE_REFRESH_TOKEN` (défaut vrai) : l'ancien `jti` est invalidé côté serveur | vrai |
| Révocation immédiate (déconnexion, compte supprimé) | `JWT_STATEFUL_VALIDATION_ENABLED` | **vrai** (une lecture de session par requête, acceptable) |
| Signature | `JWT_ALGORITHM` RS256, clé privée en variable d'environnement | RS256 |
| Intégration Ninja | `allauth.headless.contrib.ninja.security.JWTTokenAuth` | `auth=` des routers |

### Flux navigateur (BFF)

Allauth renvoie les jetons **dans le corps** de ses réponses. Le navigateur ne les voit pourtant
jamais, parce qu'il ne parle qu'au proxy Next.js (`/api/[...path]`) :

1. Login : le proxy relaie vers allauth, **retire les jetons du corps** et les pose en cookies
   `HttpOnly; Secure; SameSite` *émis par Next.js*.
2. Appel d'API : le proxy lit le cookie d'accès et ajoute `Authorization: Bearer …` vers Django.
3. 401 : le proxy appelle le refresh avec le cookie de refresh (un seul refresh à la fois par
   utilisateur grâce à un verrou), repose les deux cookies (rotation), puis **rejoue la requête
   une seule fois**.
4. Logout : le proxy appelle allauth (la session serveur et ses `jti` sont supprimés) et efface les
   cookies.

| Cookie | Attributs | Portée |
| --- | --- | --- |
| `lest_at` (access) | `HttpOnly; Secure; SameSite=Lax`, vie 5 min | `Path=/api/` |
| `lest_rt` (refresh) | `HttpOnly; Secure; SameSite=Strict`, vie 14 j | `Path=/api/` |

**Écart assumé avec CLAUDE.md** : le cahier des charges limitait le cookie de refresh au chemin
`/api/v1/auth/token/refresh/`. Or c'est le proxy, côté serveur, qui rafraîchit en réaction à un
401 sur *n'importe quelle* route d'API : il a besoin du refresh sur tout `/api/`. La portée reste
limitée à l'API (jamais envoyé avec les pages ni les fichiers statiques), et `SameSite=Strict`
empêche son envoi depuis un autre site.

**CSRF** : cookies `SameSite`, vérification de l'en-tête `Origin` par le proxy sur toute méthode
non sûre, et jeton CSRF *double-submit* exigé sur refresh et logout.

### App native (future)

Client allauth `app` : les jetons sont reçus dans le corps (canal TLS direct), stockés en
Keychain/Keystore, et envoyés en `Authorization: Bearer`. Même stratégie JWT, même révocation.

## Conséquences

- ✅ Aucun code d'authentification « maison » pour les parcours sensibles (reset, MFA, passkeys,
  limitation de débit) ; pas de DRF ni de second framework.
- ✅ Les jetons ne sont jamais accessibles au JavaScript (XSS ⇒ pas de vol de jeton) ; la CSP
  stricte reste la première défense.
- ✅ Révocation réelle : déconnexion, changement de mot de passe et suppression de compte
  invalident immédiatement l'accès.
- ⚠️ Le proxy Next.js devient un composant de sécurité : sa logique (cookies, refresh, verrou,
  rejeu unique, `Origin`) est **couverte par des tests unitaires et E2E** et relue avec
  `/security-review`.
- ⚠️ `JWT_STATEFUL_VALIDATION_ENABLED` coûte une lecture de session par requête ; à mesurer.
  Repli possible : validation sans état et access de 5 min.
- ⚠️ Le proxy doit transmettre l'IP cliente, sinon la limitation de débit d'allauth ne voit que
  l'IP de Next.js (un seul compteur pour tous). Précision de la PR 3 : en-tête dédié
  `X-Lest-Client-IP`, **écrasé** par le proxy (jamais relayé depuis le client), lu par
  `AccountAdapter.get_client_ip` ; `X-Forwarded-For` n'est jamais lu, car le client le contrôle.
- ⚠️ Dépendance forte à allauth : version épinglée, notes de version lues à chaque montée,
  Dependabot avec délai de 3 jours.
- 📋 Actions (Phase 1) :
  1. modèle `User` personnalisé dans `apps/accounts` **avant** toute migration de données ;
  2. allauth headless (`app` uniquement côté API), MFA TOTP + WebAuthn, réglages ci-dessus ;
     clé RS256 dans l'environnement ;
  3. routers Ninja protégés par `JWTTokenAuth` ;
  4. proxy : cookies, refresh sur 401 avec verrou, rejeu unique, `Origin`, `X-Lest-Client-IP` ;
  5. tests : rotation, réutilisation d'un refresh révoqué, déconnexion, isolation entre
     utilisateurs, refresh concurrents, E2E connexion / déconnexion.
