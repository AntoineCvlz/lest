# ADR 0015 — Rendre l'app installable et utilisable hors ligne, saisies en file d'attente

- **Statut** : accepté
- **Date** : 2026-11-05
- **Décideurs** : Antoine Cuvilliez (produit), Claude (proposition)

## Contexte

CLAUDE.md, principe produit 2 : l'app « fonctionne hors ligne en salle et synchronise
ensuite ». Phase 5 : PWA installable, hors ligne et synchronisation, notifications. Rien de
tout cela n'existe aujourd'hui : ni manifest, ni service worker.

L'API est prête depuis l'ADR 0003 : toutes les écritures que la file rejouera sont des `PUT`
ou des `DELETE` idempotents, sur un UUID choisi par le client (séances, exercices de séance,
séries, activités, entrées du journal) ou sur une clé naturelle (pesée et eau par jour,
mensuration par jour et par endroit). Rejouer une écriture ne crée jamais de doublon.

Choix produit du 2026-11-05 :

- hors ligne : **séance, repas, pesées, mensurations et activités** (pas seulement la séance) ;
- saisies en attente gardées dans **IndexedDB, en clair, effacées à la déconnexion** ;
- notifications : **fin du repos seulement**, locales, sans serveur de push.

Contraintes : données de santé (minimisation, CLAUDE.md principe 5) ; jamais de jeton lisible
par le JavaScript (ADR 0001 : le BFF garde les jetons en cookies `HttpOnly`) ; CSP stricte à
nonce, sans `unsafe-*` en prod ; cache privé purgé au changement de compte et à l'expiration
de la session (`PRIVATE_QUERY_KEYS`) ; Next 16 avec Turbopack.

Vérifié le 2026-11-05 sur npm : `serwist` et `@serwist/turbopack` 9.5.13 (MIT, publiés le
2026-10-04, pairs `next >= 14`, `esbuild >= 0.25`) ; `@tanstack/react-query-persist-client`
et `@tanstack/query-async-storage-persister` 5.106.1 (MIT, même famille que notre
`@tanstack/react-query`) ; `idb-keyval` 6.3.0 (Apache-2.0). Documentation de
`@serwist/turbopack` lue (service worker servi par une route Next, liste de précache
produite au build).

## Options envisagées

### Service worker

1. **Serwist (`@serwist/turbopack`)**, prévu par CLAUDE.md. Il précache tous les fichiers du
   build, y compris les pages jamais ouvertes, et fournit les stratégies de cache. Avantage :
   une page de séance s'ouvre hors ligne même si on ne l'a jamais visitée sur ce téléphone.
   Coût : 2 dépendances, plus `esbuild` pour compiler le service worker au build. Son cache
   par défaut (`defaultCache`) met aussi en cache les réponses `GET /api/*` : à ne **pas**
   reprendre.
2. **Service worker écrit à la main.** Sans dépendance, mais sans liste de précache : il ne
   connaît que les fichiers déjà chargés. Une page jamais ouverte ne marche pas hors ligne,
   et il faut maintenir nous-mêmes versionnage et nettoyage des caches.
3. **Pas de service worker**, file d'attente seule. L'app ne s'ouvre pas sans réseau : une
   coupure au moment d'ouvrir l'app en salle rend la file inutile.

### File d'attente des saisies

1. **Mutations en pause de TanStack Query, persistées** (`PersistQueryClientProvider`,
   `setMutationDefaults`, `resumePausedMutations`). Nos écritures sont déjà des mutations
   avec mises à jour optimistes ; une portée commune (`scope`) les exécute une par une, dans
   l'ordre de saisie. Coût : chaque écriture doit être déclarée par une clé de mutation (sa
   fonction est retrouvée par la clé après un rechargement), et non plus en ligne dans le hook.
2. **File maison dans IndexedDB.** Contrôle complet, mais elle double ce que TanStack fait
   déjà (pause, reprise, ordre, état « en attente » pour l'interface) et l'état optimiste
   serait à réconcilier à la main.
3. **Background Sync API.** Rejoue même l'app fermée, mais Chromium seulement (ni Safari ni
   Firefox). De plus, le service worker devrait envoyer les requêtes lui-même, alors que le
   rafraîchissement des jetons passe par le BFF et les pages.

## Décision

**Serwist pour la coque de l'app, mutations persistées de TanStack Query pour les saisies,
IndexedDB pour les deux, tout effacé à la déconnexion.** Le service worker ne met jamais en
cache une réponse de l'API : les données hors ligne vivent dans le cache de TanStack Query,
déjà purgé avec le compte.

### Service worker (cache de l'app, pas des données)

| Contenu | Stratégie |
| --- | --- |
| Fichiers du build (`/_next/static/…`), icônes, manifest | Précache Serwist, versionné par le build |
| Pages (documents et charges RSC) | Réseau d'abord avec délai (3 s), copie en cache sinon, puis page « hors ligne » |
| Images d'exercices (`/api/v1/exercise-images/…`, publiques, ADR 0005) | Cache d'abord, 300 entrées au plus |
| Tout le reste de `/api/` | **Jamais intercepté** (`NetworkOnly`, aucune copie) |

- Pages en cache : la coque HTML ne contient aucune donnée de santé (tout vient de l'API côté
  client). Un test le vérifie sur les pages privées.
- Les pages en cache gardent le nonce de leur réponse d'origine. C'est accepté : le document est
  figé, et rien de ce qu'il affiche hors ligne n'est inséré sans échappement (React, données
  d'IndexedDB).
- À la déconnexion, la page demande au service worker de vider le cache des pages : `/` diffère
  selon la session, Bilan ou page publique.
- Pas de service worker en dev (Turbopack, rechargement à chaud). Le hors-ligne se teste sur le
  build de prod, en E2E.
- Mise à jour : nouveau service worker activé au prochain lancement, jamais en pleine séance
  (pas de `skipWaiting` forcé pendant qu'une saisie est en attente).
- CSP : `worker-src 'self'` et `manifest-src 'self'` ajoutés, rien d'autre.

### Saisies hors ligne

| Règle | Choix |
| --- | --- |
| Écritures mises en file | séance (séance, exercices de séance, séries), journal des repas, eau, pesées, mensurations, activités |
| Écritures jamais mises en file | photos (15 Mo), programmes, objectifs, profil, compte, sécurité, Basic-Fit : réseau exigé, message clair hors ligne |
| Ordre | une seule portée : rejouées une par une, dans l'ordre de saisie (parent avant enfant, ADR 0003) |
| Échec réseau, 5xx, 429, délai dépassé | gardée en file, nouvel essai avec délai croissant, au retour du réseau ou de l'app au premier plan |
| 401 (session expirée hors ligne) | gardée ; l'écran demande de se reconnecter, puis la file reprend |
| 4xx définitif (422, 404) | retirée de la file, état optimiste annulé, message qui dit quelle saisie a été refusée |
| Plusieurs onglets | un seul rejoue la file (`navigator.locks`) ; rejouer deux fois reste sans effet (idempotence) |
| Indicateur | nombre de saisies en attente et dernier envoi réussi, annoncés poliment (`aria-live`) |

### Données gardées dans le navigateur

| Gardé (IndexedDB, durée 7 jours) | Pourquoi |
| --- | --- |
| Saisies en attente | la file elle-même |
| Séance en cours, dernières séries de ses exercices, programmes | saisir une série hors ligne avec la charge pré-remplie |
| Catalogue d'exercices et de sports déjà consultés | choisir un exercice ou un sport |
| Journal du jour, aliments récents et aliments perso | ajouter un repas déjà connu (la recherche Ciqual et le code-barres exigent le réseau) |
| Profil (unités, formule du 1RM) | affichage |

Rien d'autre n'est gardé : historique, Bilan, courbes, photos et export restent en ligne.

- Lié au compte : la copie porte l'identifiant du compte. À la connexion d'un autre compte,
  elle est effacée **sans être rejouée**.
- Chaque saisie en file porte aussi son compte, envoyé dans l'en-tête `X-Lest-Account` (relayé
  par le BFF). Django répond 409 `account-mismatch` avant la route si le jeton est celui d'un
  autre compte : une saisie rejouée après un changement de compte dans un autre onglet n'écrit
  jamais chez l'autre, sans dépendre de l'ordre des événements côté navigateur. Ajouté le
  2026-11-09, pendant la PR 3.
- Déconnexion volontaire : la copie est effacée. Si des saisies sont en attente, l'écran
  demande d'abord : attendre leur envoi, ou les abandonner (nombre affiché).
- Session expirée (refresh refusé) : le cache privé est retiré comme aujourd'hui, mais les
  saisies en attente sont gardées pour ce compte jusqu'à la reconnexion.
- Copie invalidée à chaque version du schéma de l'API (`buster`).

### Notification de fin de repos

Locale, par `registration.showNotification`, seulement si l'utilisateur l'active (permission
demandée au clic, jamais au chargement) et si la page est en arrière-plan. Texte fixe
(« Repos terminé »), aucune donnée de santé. Pas de serveur de push, pas de clé VAPID, aucun
tiers.

## Conséquences

- ✅ La séance se saisit sans réseau, et les autres saisies du quotidien aussi. Les routes
  ne changent pas (ADR 0003) ; seule l'authentification lit en plus `X-Lest-Account`.
- ✅ Aucune réponse d'API dans le cache du service worker : une seule copie des données,
  purgée par le mécanisme existant.
- ⚠️ Données de santé en clair sur le téléphone, jusqu'à 7 jours ou jusqu'à la déconnexion.
  C'est le choix produit : chiffrer avec une clé gardée au même endroit ne protégerait pas
  d'un script de la page, seulement d'une lecture brute du disque. La protection reste celle du
  téléphone (verrouillage, chiffrement du stockage). Le README le dira, et l'écran
  de déconnexion aussi.
- ⚠️ « Dernière écriture gagne » (ADR 0003) s'applique aussi aux saisies rejouées tard : une
  pesée saisie hors ligne remplace une pesée du même jour saisie ailleurs entre-temps. C'est
  accepté pour un seul utilisateur. L'eau du jour est une valeur absolue, pas un ajout : le
  dernier envoi gagne.
- ⚠️ Rejouer tard expose aux plafonds (20 activités par jour, 100 entrées) et aux limites de
  débit : 429 gardé en file, 422 montré à l'utilisateur.
- ⚠️ Notification de fin de repos au mieux : un onglet en arrière-plan peut voir ses
  minuteurs ralentis (Chrome Android), et iOS n'accepte les notifications que pour une app
  installée (16.4+). La vibration et l'heure de fin restent la référence.
- ⚠️ 5 dépendances front (`serwist`, `@serwist/turbopack`, `esbuild`,
  `@tanstack/react-query-persist-client`, `@tanstack/query-async-storage-persister`) plus
  `idb-keyval`, chacune justifiée dans sa PR et soumise au délai de 3 jours de pnpm.
  À vérifier dans la PR du service worker : `esbuild` n'est requis qu'au build (route
  prérendue), jamais dans l'image de prod.
- 📋 PR 1 : app installable (manifest, icônes, couleur du thème, `manifest-src`).
- 📋 PR 2 : service worker Serwist (précache, pages, images, page hors ligne, `worker-src`,
  purge à la déconnexion), test « pas de donnée de santé dans les pages en cache ».
- 📋 PR 3 : persistance et file d'attente pour la séance (clés de mutation, portée commune,
  politique d'erreurs, liaison au compte, indicateur, déconnexion avec saisies en attente).
- 📋 PR 4 : même file pour repas, eau, pesées, mensurations et activités.
- 📋 PR 5 : notification de fin de repos.
- 📋 E2E sur le build de prod avec le réseau coupé (`context.setOffline`) : saisir une série,
  une pesée et un repas hors ligne, revenir en ligne, vérifier l'envoi ; changer de compte et
  vérifier qu'aucune saisie n'est rejouée.
