# CLAUDE.md — Lest

Règles permanentes du projet. À relire au début de chaque session, à tenir à jour à chaque fin de phase (commandes, conventions, décisions).

## Rôle

Tu es un·e Staff Engineer full-stack (Django / Next.js) et Product Designer senior. Tu travailles avec un développeur qui se positionne en expert : chaque choix doit être défendable en revue de code, documenté et testé. Jamais de « vite fait » : tu proposes, il approuve, tu livres petit et propre.

## Produit

**Lest** (nom de marque à valider : INPI/EUIPO classes 9 et 41, domaine, stores). Application web responsive, installable (PWA), pour suivre :

- une **prise de masse** : poids de corps, mensurations, photos de progression, calories et macros ;
- la **musculation en salle** (ex. Basic-Fit) : séances, exercices, séries, charges, reps, RPE, records ;
- **tout autre sport** via un modèle d'activité générique (durée, distance, intensité, métriques libres).

### Principes produit

1. Saisie d'une série en moins de 3 secondes, d'une main, entre deux séries.
2. Fonctionne hors ligne en salle et synchronise ensuite.
3. Les données appartiennent à l'utilisateur : export CSV/JSON, suppression de compte complète (RGPD).
4. Basic-Fit connecté via le client non officiel `basicfit`, isolé derrière un adaptateur et désactivable. Import CSV (Strong, Hevy) possible plus tard.
5. Données de santé sensibles : minimisation, chiffrement au repos des champs sensibles, aucun tracker tiers.

## Domaines métier (bounded contexts)

Une app Django par domaine, **aucun import croisé direct entre leurs modèles** (passer par des services ou des signaux de domaine).

| App | MVP | Entités |
| --- | --- | --- |
| `accounts` | Inscription, connexion, profil (taille, objectif, unités kg/lb), export et suppression RGPD | User, Profile, Goal |
| `training` | Programmes, séance en cours + minuteur de repos, séries (poids, reps, RPE, échauffement), historique par exercice, records (1RM estimé Epley/Brzycki) | Exercise, Program, Workout, WorkoutExercise, Set, PersonalRecord |
| `activities` | Autres sports : type, durée, distance, FC moyenne, ressenti, métriques libres (JSON validé par schéma) | SportType, Activity |
| `nutrition` | Journal des repas, aliments (Open Food Facts + perso), scan code-barres, objectifs kcal/macros (Mifflin-St Jeor + surplus), eau | Food, Meal, MealItem, NutritionTarget |
| `body` | Poids quotidien (moyenne mobile 7 j), mensurations, photos privées | BodyMetric, Measurement, ProgressPhoto |
| `gyms` | Salles, équipements disponibles pour filtrer les exercices | Gym, Equipment |
| `insights` | Tableau de bord : poids vs objectif, volume hebdo par groupe musculaire, progression d'un exercice, adhérence nutrition | Lectures agrégées, pas de table propre |

### Règles métier à tester en priorité

- volume = Σ (poids × reps) des séries de travail, hors échauffement ;
- un record est détecté à l'enregistrement d'une série et historisé ;
- stockage en unités SI, conversion à l'affichage uniquement ;
- toute requête est filtrée par propriétaire — aucune fuite inter-utilisateurs, **testé explicitement**.

## Intégration Basic-Fit et données d'exercices

Package `basicfit` (v1.0.0, juillet 2026, MIT, un seul mainteneur) : client async non officiel de l'API de l'app Basic-Fit. Pas de catalogue de machines.

| `basicfit` fournit | Usage dans Lest |
| --- | --- |
| Profil membre : abonnement, club principal | Pré-remplit profil et salle par défaut |
| Historique des visites (365 j max par requête) | Calendrier d'assiduité ; visite sans séance → proposer de la compléter |
| Mesures des balances en club (poids, % gras, muscle, eau) | Import dans `body`, source « Basic-Fit », dédoublonnage par date |
| Badges | Affichés dans le profil, sans gamification supplémentaire |
| Catalogue d'entraînements (public) | Modèles de programmes à importer |
| Recettes avec macros (public) | Aliments composés dans les repas |
| Recherche de clubs + image (public) | Création des `Gym` sans saisie manuelle |

Non exposé : journal de progression des séances, affluence des clubs. Vérifier le dépôt avant la Phase 4 ; proposer une PR upstream si simple.

**Exercices** : source principale API REST wger (`/api/v2/exerciseinfo/`, ~845 exercices, CC-BY-SA → **attribution obligatoire dans l'app**), synchronisée par la commande `import_exercises`. Machines guidées de salle ajoutées comme `Equipment` maison, annotables par club (« présent dans ma salle »). Secours : free-exercise-db (domaine public).

### Règles d'implémentation

- App `integrations/basicfit/` : adaptateur `BasicFitGateway` (seul point de contact avec le package), DTO internes, mapping vers nos modèles. **Aucun autre module n'importe `basicfit`.**
- Connexion OAuth2 PKCE du package. Login Basic-Fit protégé par anti-bot : l'utilisateur se connecte dans son navigateur puis colle l'URL de redirection ; l'écran l'explique clairement.
- Refresh tokens rotatifs à chaque appel : persister le nouveau jeu via le callback `token_updated`, chiffré en base (`django-cryptography` ou Fernet, clé en variable d'environnement), **jamais loggé**.
- Synchro via tâche Celery : max 1×/heure/utilisateur, backoff exponentiel, déclenchable manuellement ; gérer `BasicFitAuthError` (demande de reconnexion) et `BasicFitAPIError`.
- Tests avec réponses enregistrées (fixtures JSON), aucun appel réseau réel en CI.
- Feature flag `BASICFIT_ENABLED` : l'app reste entièrement utilisable sans.
- ADR obligatoire avec les risques : API non officielle (casse possible, CGU Basic-Fit), usage limité au compte personnel ; paquet sans provenance PyPI → version épinglée par hash, code relu avant chaque mise à jour.

## Stack et architecture

Dernières versions stables au moment de l'init, épinglées (lockfiles). **Tout ajout de dépendance est justifié dans la PR.**

### Back-end

- Python 3.13+, Django 5.x LTS si disponible, dépendances via `uv`.
- API : **Django Ninja** (décidé, pas DRF). Schémas Pydantic, OpenAPI généré nativement par Ninja (pas de `drf-spectacular`), plugin mypy Pydantic activé.
- PostgreSQL 17, Redis (cache + broker) ; tâches de fond **Celery + beat** : import d'aliments, recalcul des records, export, synchro Basic-Fit.
- Auth (**ADR 0001**) : `django-allauth` *headless*, stratégie **JWT native** (RS256, access 5 min, refresh 14 j, rotation + invalidation de l'ancien, validation avec état), routers Ninja protégés par `JWTTokenAuth` d'allauth. **Pas de DRF** : simplejwt et dj-rest-auth en dépendent. Allauth fournit inscription, reset, limitation de débit, MFA TOTP et passkeys.
  - Navigateur = **BFF** : le proxy Next.js retire les jetons des réponses d'allauth et les garde en cookies `HttpOnly; Secure` émis par Next (`lest_at` SameSite=Lax, `lest_rt` SameSite=Strict, `Path=/api/`) ; il ajoute `Authorization: Bearer` vers Django ;
  - le proxy refresh sur 401 et rejoue la requête une seule fois (verrou contre les refresh concurrents), vérifie `Origin` sur les méthodes non sûres, transmet `X-Forwarded-For` ; CSRF double-submit sur refresh et logout ;
  - écart assumé : cookie refresh en `Path=/api/` (et non limité à l'URL de refresh), parce que le refresh se fait côté serveur sur n'importe quel 401 ;
  - future app native : client allauth `app`, jetons en Keychain/Keystore ;
  - **jamais de token lisible par le JavaScript** (ni `localStorage`, ni corps de réponse reçu par le navigateur).
- Couches par app : `models` → `selectors` (lectures) → `services` (écritures, règles métier, transactions) → `api` (schémas Pydantic + routers Ninja minces). **Aucune logique métier dans les routers ou les schémas.**
- Settings `base` / `dev` / `test` (+ `prod`), config par variables d'environnement (`django-environ`), aucun secret commité.

### Front-end

- Next.js (App Router) + React + TypeScript strict, `pnpm`.
- Client API typé généré depuis l'OpenAPI (`openapi-typescript` + `openapi-fetch` ou Orval) : **jamais de types API écrits à la main**.
- TanStack Query (état serveur, optimistic updates, cache hors ligne) ; React Hook Form + Zod.
- Tailwind CSS v4 + design tokens maison ; primitives Radix UI ou React Aria ; shadcn/ui seulement comme point de départ, entièrement restylé.
- Graphiques Visx ou Recharts, toujours avec alternative texte/tableau.
- PWA : manifest, service worker (Serwist), file d'attente hors ligne des séries.
- Feature-sliced : `app/` (routes), `features/<domaine>/` (composants, hooks, schémas), `shared/` (ui, lib, api).

**Flux** : navigateur → Next.js (SSR + proxy `/api`) → Django API → PostgreSQL / Redis ; worker Celery consomme Redis.

## Infra Docker de développement

`just up` lance tout ; chaque modification de code visible immédiatement sans rebuild. Pas de déploiement pour l'instant, mais cible `prod` propre dans chaque Dockerfile.

| Service | Image / build | Rôle en dev |
| --- | --- | --- |
| `db` | `postgres:17-alpine` | Volume nommé, healthcheck `pg_isready` |
| `redis` | `redis:7-alpine` | Cache + broker |
| `api` | `backend/Dockerfile` cible `dev` | `runserver 0.0.0.0:8000`, code monté, attend `db` healthy |
| `worker` | même image que `api` | Celery avec rechargement auto (`watchfiles`) |
| `web` | `frontend/Dockerfile` cible `dev` | `next dev --turbopack`, `node_modules` en volume anonyme |
| `mailpit` | `axllent/mailpit` | Capture des e-mails |
| `proxy` (option) | Caddy | Un seul domaine `localhost` pour front + `/api` |

- Dockerfiles multi-stage `base` → `dev` → `build` → `prod`, images slim, utilisateur non-root, pas de secrets en `ARG`.
- Hot reload fiable sous Docker Desktop : `develop.watch` de Compose (`sync` pour le code, `rebuild` pour les lockfiles) ; `WATCHPACK_POLLING` seulement si nécessaire.
- `.env.example` complet et documenté ; `.env` ignoré par git.
- Lanceur de tâches : **`justfile`** (choisi à la place du `Makefile` pour fonctionner nativement sous Windows). Python, `uv` et Node tournent dans les conteneurs ; sur l'hôte, seuls `uv` (pre-commit) et pnpm via `corepack` sont requis.
- Cibles : `up`, `down`, `logs`, `sh-api`, `migrate`, `makemigrations`, `test`, `lint`, `fmt`, `typegen`, `reset-db`, `hooks` (installe pre-commit), `check` (pre-commit sur tout le dépôt). La synchro `develop.watch` est à sens unique : les recettes qui **écrivent** du code (`makemigrations`, `fmt`, `typegen`) passent par un conteneur jetable avec le dossier monté.
- `seed` (Phase 1, après le modèle `User` personnalisé) : utilisateur démo, ~150 exercices (groupes musculaires, équipement), 8 semaines de séances et de poids réalistes.
- Option devcontainer (`.devcontainer/`) : reportée, `just` + Docker couvrent le besoin.
- E2E en CI sur les **images de prod** (`compose.e2e.yaml`) ; Playwright tourne dans l'image officielle `mcr.microsoft.com/playwright` (épinglée par digest).

## Structure du repo

```text
lest/
├── backend/
│   ├── config/               # settings/{base,dev,test}.py, urls, asgi/wsgi, celery
│   ├── apps/
│   │   ├── accounts/ training/ activities/ nutrition/ body/ gyms/ insights/
│   │   │   └── models.py selectors.py services.py api/ tests/ admin.py
│   ├── common/               # mixins, permissions, pagination, exceptions
│   ├── pyproject.toml uv.lock Dockerfile
├── frontend/
│   ├── src/app/ src/features/ src/shared/{ui,lib,api}/
│   ├── tests/e2e/            # Playwright
│   ├── package.json pnpm-lock.yaml Dockerfile
├── docs/
│   ├── adr/                  # 0001-choix-auth.md, 0002-offline-sync.md…
│   ├── architecture.md       # diagrammes C4 en Mermaid
│   └── design-system.md
├── .github/ workflows/ CODEOWNERS dependabot.yml pull_request_template.md
├── compose.yaml justfile .env.example .pre-commit-config.yaml
├── CLAUDE.md README.md SECURITY.md CONTRIBUTING.md LICENSE
```

## Conventions

- **Licence** : propriétaire, tous droits réservés (`LICENSE`, `"license": "UNLICENSED"` côté npm). Aucune dépendance à licence copyleft forte (GPL/AGPL) sans validation explicite.
- **Dépôt public** (code visible, non libre) : CodeQL et OpenSSF Scorecard actifs. Conséquence : rien de personnel ni de sensible dans l'historique (fixtures anonymisées, aucune vraie réponse Basic-Fit, aucun token) — Gitleaks bloque, et toute fixture enregistrée est relue avant commit.
- **Fins de ligne** : LF partout (`.gitattributes`), le poste de dev étant sous Windows.
- **Commits** : Conventional Commits (`feat(training): …`), vérifiés par commitlint. Branches `feat/`, `fix/`, `chore/`. `main` protégée, squash merge.
- **Python** : Ruff (lint + format), mypy strict + `django-stubs`, typage complet, docstrings sur les services publics.
- **TypeScript** : `strict: true`, ESLint flat config (`jsx-a11y`, `react-hooks`), Prettier ou Biome, **pas de `any`**.
- **API** : versionnée `/api/v1/`, erreurs RFC 9457 (`application/problem+json`), pagination par curseur, ressources au pluriel.
- **Décisions** : toute décision structurante = un ADR court (contexte, options, choix, conséquences) dans `docs/adr/`.
- **README** : pitch, captures, schéma d'archi, démarrage en 3 commandes, choix techniques et pourquoi.

## Qualité et tests

Une PR ne fusionne que si tous les jobs CI sont verts ; les mêmes vérifications tournent en local via `pre-commit`.

- **Back** : pytest + pytest-django + factory-boy ; couverture ≥ 85 % sur `services` et `selectors` ; tests de permissions par endpoint (B ne lit jamais les données de A).
- **Front** : Vitest + Testing Library, MSW pour mocker l'API.
- **E2E** : Playwright sur les parcours critiques (inscription, séance, repas, courbe de poids), viewports mobile et desktop, `@axe-core/playwright` sur chaque page.
- **Contrat** : le schéma OpenAPI commité doit être identique au schéma généré (échec si drift).

### CI GitHub Actions (un workflow par responsabilité)

| Job | Outils | Bloquant |
| --- | --- | --- |
| Lint & types | Ruff, mypy, ESLint, `tsc --noEmit`, commitlint | Oui |
| Tests back | pytest + services Postgres/Redis | Oui |
| Tests front | Vitest, build Next.js | Oui |
| E2E + a11y | Playwright + axe sur la stack Compose | Oui |
| SAST | CodeQL (Python + JS/TS), Semgrep, Bandit | Oui sur sévérité haute |
| Secrets | Gitleaks (pre-commit + CI) | Oui |
| Dépendances | `pip-audit`, `pnpm audit`, Dependabot / Renovate | Oui sur critique |
| Conteneurs | Hadolint, Trivy (image + config), SBOM Syft | Oui sur critique |
| Django | `manage.py check --deploy` (settings prod), `makemigrations --check` | Oui |
| Lighthouse CI | Performance, a11y ≥ 95, bonnes pratiques | Avertissement |

### Durcissement du pipeline

- `permissions: contents: read` par défaut, élargi job par job.
- Actions tierces épinglées par SHA de commit, mises à jour par Dependabot.
- Pas de `pull_request_target` sur du code non fiable ; secrets absents des PR de forks.
- `step-security/harden-runner` en mode audit ; cache des dépendances indexé sur les lockfiles.
- `main` protégée : revue obligatoire, checks requis, commits signés, historique linéaire.
- OpenSSF Scorecard hebdomadaire.

## Sécurité applicative (OWASP ASVS niveau 2)

- Argon2 pour les mots de passe ; rate limiting sur login et reset ; verrouillage progressif.
- En-têtes : CSP stricte avec nonce côté Next.js, HSTS (prêt pour prod), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- CORS restreint ; cookies `Secure` / `HttpOnly` / `SameSite=Lax` ; CSRF actif.
- Uploads photos : MIME vérifié, EXIF supprimé (géolocalisation), stockage privé, URL signées.
- Journaux sans données de santé ni PII ; `SECURITY.md` décrit la divulgation responsable.

## Design, accessibilité et ergonomie

L'interface ne doit pas ressembler à un template généré par IA. **Avant tout composant**, proposer 2 ou 3 directions visuelles (moodboard textuel, palette, typographies, un écran clé), attendre le choix, le consigner dans `docs/design-system.md`.

- **À éviter** : dégradés violet-bleu, glassmorphism partout, grilles de cartes arrondies identiques, Inter par défaut, icônes emoji, illustrations 3D génériques, textes « Unlock your potential ».
- **Direction attendue** : caractère affirmé, cohérent avec l'univers « salle de sport » (carnet d'entraînement éditorial, instrument de mesure technique…) ; typographie d'affichage distinctive + police lisible à chiffres tabulaires ; une seule couleur d'accent ; mode sombre soigné par défaut ; micro-interactions sobres respectant `prefers-reduced-motion`.

### Design system

- Tokens (couleurs, espacements, rayons, ombres, typo, durées) définis une fois en CSS custom properties, consommés par Tailwind.
- Composants documentés dans Storybook + addon a11y ; régression visuelle (screenshots Playwright ou Chromatic).

### Accessibilité — WCAG 2.2 AA minimum (compatible RGAA 4.1)

- Contrastes ≥ 4,5:1 (texte) et ≥ 3:1 (éléments d'interface), dans les deux thèmes.
- Navigation clavier complète, focus visible, ordre logique, liens d'évitement.
- Cibles tactiles ≥ 44 × 44 px ; aucune action uniquement au geste.
- HTML sémantique d'abord, ARIA seulement si nécessaire ; labels sur tous les champs, erreurs annoncées (`aria-live`).
- Graphiques : résumé textuel + tableau de données accessible ; jamais la couleur seule pour porter le sens.
- Zoom 200 % et texte agrandi sans perte ; `lang="fr"` ; i18n prête (next-intl).

### Ergonomie mobile (usage en salle)

- Actions principales dans la zone du pouce (onglets en bas, bouton « + Série » fixe).
- Pré-remplissage avec la dernière charge, pas de ±2,5 kg, minuteur de repos avec vibration.
- Écran maintenu allumé pendant la séance (Wake Lock API) ; états vides, chargement et erreur toujours conçus.
- Heuristiques de Nielsen vérifiées à chaque nouvel écran ; LCP < 2,5 s, INP < 200 ms sur mobile milieu de gamme.

## Outils Claude Code

Utiliser ces outils quand ils sont installés ; **s'il en manque un, le signaler et proposer de l'ajouter** plutôt que s'en passer en silence.

| Outil | Quand |
| --- | --- |
| `frontend-design` | Avant tout écran : direction visuelle distinctive |
| `webapp-testing` / Playwright MCP | Piloter l'app, captures mobile + desktop, axe, console |
| Context7 MCP | Doc à jour (Django, DRF, Next.js, TanStack Query) avant d'écrire du code d'API |
| GitHub MCP / `gh` | Issues, PR, résultats de CI |
| `/security-review` | Avant chaque PR touchant auth, uploads, permissions ou données de santé |
| `security-guidance` | Alertes pendant l'édition |
| `code-review` / `pr-review-toolkit` | Revue multi-angle de PR |
| `feature-dev` | Exploration → architecture → implémentation pour chaque nouveau domaine |
| `commit-commands` | Commits conventionnels et ouverture de PR |
| `skill-creator` | Création des skills projet |

- **Skills projet** (`.claude/skills/`) : `adr` ✅ ; `lest-ui` ✅ (tokens, composants existants, a11y, CSP, vérification du rendu réel : **à charger avant tout travail d'interface**) ; `django-domain-app` à créer avec la première vraie app (`accounts`).
- **Sous-agents** (`.claude/agents/`) ✅ : `a11y-auditor` (WCAG 2.2, lecture seule), `security-reviewer` (OWASP ASVS), `test-writer` (cas limites et permissions).
- **Hooks** (`.claude/settings.json`) ✅, scripts Node dans `.claude/hooks/` (indépendants du shell) : ruff + mypy après édition d'un `.py` (≈ 2 s) ; ESLint + `tsc` après un `.ts(x)` (10 à 30 s selon la machine, en parallèle ; borné par ESLint typé) ; lancés **sans shell** (Semgrep `spawn-shell-true`) ; refus de toute écriture dans `.env*` (outils d'édition et redirections shell) et de tout `git push` forcé.
- **Installés au niveau du projet** (`enabledPlugins` dans `.claude/settings.json`, marketplace `claude-plugins-official`) : `context7`, `security-guidance` (exige `python3` dans le PATH ; revue LLM du diff à chaque tour), `pr-review-toolkit`, `feature-dev`, `commit-commands` ; `frontend-design` est installé côté utilisateur.
- **Playwright MCP** : déclaré dans `.mcp.json`, **épinglé** (`@playwright/mcp@0.0.83`, et non le `@latest` du plugin officiel), Chromium sans interface et en profil isolé, navigation limitée aux origines locales (`--allowed-origins`), captures dans `.playwright-mcp/` (ignoré). Remplace `webapp-testing`.
- **GitHub MCP non installé** : il exige un jeton d'accès personnel ; `gh` (authentifié) couvre PR, CI et issues.

## Roadmap

Chaque phase se termine par une démo fonctionnelle sur `localhost`, CI verte et README à jour.

0. **Socle** ✅ (2026-10-27) : monorepo, Compose + hot reload, Django + Next.js « hello » reliés, pre-commit, CI complète (16 checks requis sur `main`), `CLAUDE.md`, ADR 0001 (auth).
1. **Comptes & design system** : directions visuelles → choix → tokens, Storybook, auth, profil, onboarding.
2. **Musculation** : import wger + équipements, séance en cours, séries, minuteur, historique, records.
3. **Corps & nutrition** : poids + moyenne mobile, mensurations, photos, journal alimentaire, Open Food Facts, objectifs macros.
4. **Autres sports & insights** : activités génériques, Basic-Fit (visites, pesées, clubs, recettes), tableau de bord, graphiques accessibles.
5. **Mobile** : PWA installable, hors ligne + synchronisation, notifications. Option : app native Expo réutilisant le client API typé.

## Règles de travail

- Commencer chaque tâche par un plan court (fichiers touchés, risques, tests prévus) ; attendre validation pour tout ce qui est structurant.
- TDD sur la logique métier : test rouge → code → refactor.
- Petites PR (< 400 lignes hors fichiers générés), une intention par PR, captures pour l'UI.
- Après chaque changement d'UI : ouvrir la page avec Playwright, capture mobile + desktop, lancer axe, corriger avant de rendre la main.
- **Ne jamais désactiver** un test, une règle de lint ou un contrôle de sécurité pour passer la CI ; expliquer le problème à la place.
- En cas d'hésitation entre deux options : les présenter en 3 lignes avec une recommandation.
- Tenir ce fichier à jour (commandes, conventions, décisions) à chaque fin de phase.

## Décisions et constats de la Phase 0 (à respecter)

- **Versions fixées** (Dependabot ignore leurs majeures) : Python 3.13, Django 5.2 LTS, Node 24 LTS (via `devEngines.runtime` : pnpm télécharge Node 24 quel que soit le Node de l'hôte), Postgres 17, Redis 7, **TypeScript 5.9** et **ESLint 9** (TS 7 / ESLint 10 pas encore supportés par `openapi-typescript`, `typescript-eslint`, `jsx-a11y`).
- **Supply chain** : pnpm `minimumReleaseAge: 1440` sans exception ; Dependabot avec délai de 3 jours ; actions épinglées par SHA ; images d'outils par digest ; hooks pre-commit figés par SHA.
- **Next 16** : `middleware.ts` s'appelle `src/proxy.ts` ; `cacheComponents`/`partialPrefetching` désactivés (incompatibles avec la CSP à nonce) ; le layout racine appelle `connection()`.
- **Tests back** : `--ds=config.settings.test` dans `addopts` (la variable `DJANGO_SETTINGS_MODULE` des conteneurs primerait sinon) ; `filterwarnings = error`.
- **Images de prod** : sans pip ni npm (failles dans leurs copies embarquées) ; `USER` numérique ; Debian 13.
- **Fusion** : squash, titre de PR au format commitlint (il devient le message sur `main`).

**Définition de « terminé »** : tests et CI verts, aucune alerte de sécurité haute, axe sans violation, types générés à jour, documentation et ADR écrits, démo visible sur le serveur de dev.
