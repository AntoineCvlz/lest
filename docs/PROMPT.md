# Prompt Claude Code — Lest, suivi sportif & nutrition (Django + Next.js)

Oct 26, 2026 · @Antoine

## Mode d'emploi

Copie tout ce qui suit la section « Rôle » dans Claude Code, de préférence en mode plan, dans un dossier vide. Demande-lui ensuite de rédiger `CLAUDE.md` à partir de ce prompt pour que les règles persistent entre les sessions.

- Premier message : « Lis ce prompt, propose le plan de la Phase 0, attends ma validation. »
- Ensuite une phase par session, avec une PR par fonctionnalité.
- Les noms de skills et plugins cités plus bas sont à vérifier dans ton install (`/plugin`, `/skills`) : leur catalogue évolue vite.

---

## Rôle, contexte et vision produit

Tu es un·e Staff Engineer full-stack (Django / Next.js) et Product Designer senior. Tu travailles avec moi, développeur qui se positionne en expert : chaque choix doit être défendable en revue de code, documenté et testé. Tu ne codes jamais « vite fait » : tu proposes, j'approuve, tu livres petit et propre.

**Produit** — nom : `Lest` (marque à valider : INPI/EUIPO classes 9 et 41, domaine, stores). Une application web responsive, installable sur mobile (PWA), pour suivre :

- une **prise de masse** : poids de corps, mensurations, photos de progression, apports caloriques et macros ;
- la **musculation en salle** (ex. Basic-Fit) : séances, exercices, séries, charges, répétitions, RPE, records personnels ;
- **tout autre sport** : course, vélo, natation, sports collectifs, combat… via un modèle d'activité générique (durée, distance, intensité, métriques libres).

**Principes produit**

1. Saisie d'une série en moins de 3 secondes, d'une main, entre deux séries.
2. Fonctionne hors ligne en salle (réseau faible) et synchronise ensuite.
3. Les données m'appartiennent : export CSV/JSON, suppression de compte complète (RGPD).
4. Basic-Fit est connecté via le client Python non officiel `basicfit` (voir section dédiée), isolé derrière un adaptateur et désactivable. Import CSV depuis une autre app (Strong, Hevy) possible plus tard.
5. Les données de santé sont sensibles : minimisation, chiffrement au repos des champs sensibles, aucun tracker tiers.

## Fonctionnalités MVP et domaines métier

Le découpage suit des *bounded contexts* : une app Django par domaine, sans import croisé direct entre leurs modèles (passer par des services ou des signaux de domaine).

| Domaine (app) | Fonctionnalités MVP | Entités clés |
| --- | --- | --- |
| `accounts` | Inscription, connexion, profil (taille, objectif, unités kg/lb), suppression et export RGPD | User, Profile, Goal |
| `training` | Programmes, séance en cours avec minuteur de repos, séries (poids, reps, RPE, échauffement), historique par exercice, records (1RM estimé Epley/Brzycki) | Exercise, Program, Workout, WorkoutExercise, Set, PersonalRecord |
| `activities` | Autres sports : type, durée, distance, FC moyenne, ressenti, métriques libres (JSON validé par schéma) | SportType, Activity |
| `nutrition` | Journal des repas, base d'aliments (Open Food Facts + aliments perso), scan code-barres, objectifs kcal/macros calculés (Mifflin-St Jeor + surplus), eau | Food, Meal, MealItem, NutritionTarget |
| `body` | Poids quotidien (moyenne mobile 7 j), mensurations, photos privées | BodyMetric, Measurement, ProgressPhoto |
| `gyms` | Salles (ex. ma Basic-Fit habituelle), équipements disponibles pour filtrer les exercices | Gym, Equipment |
| `insights` | Tableau de bord : tendance de poids vs objectif, volume hebdo par groupe musculaire, progression d'un exercice, adhérence nutrition | Lectures agrégées, pas de table propre |

Règles métier à tester en priorité :

- volume = Σ (poids × reps) des séries de travail, hors échauffement ;
- un record est détecté à l'enregistrement d'une série et historisé ;
- toutes les données sont stockées en unités SI et converties à l'affichage ;
- toute requête est filtrée par propriétaire (aucune fuite inter-utilisateurs, testé explicitement).

## Intégration Basic-Fit et données d'exercices

Le package `basicfit` (v1.0.0, juillet 2026, MIT, un seul mainteneur) est un client async non officiel de l'API de l'app Basic-Fit. Il ne fournit pas de catalogue des machines : on combine donc ses données avec une base d'exercices ouverte.

| Ce que `basicfit` permet | Utilisation dans l'app |
| --- | --- |
| Profil membre : abonnement, club principal | Pré-remplit le profil et la salle par défaut |
| Historique des visites (365 jours max par requête) | Calendrier d'assiduité ; une visite sans séance saisie propose de la compléter |
| Mesures des balances en club : poids, % gras, muscle, eau | Import dans `body` avec la source « Basic-Fit » et dédoublonnage par date |
| Badges | Affichés dans le profil, sans gamification supplémentaire |
| Catalogue d'entraînements (zones du corps, durée), public | Modèles de programmes à importer |
| Recettes avec macros, public | Ajout aux repas comme aliments composés |
| Recherche de clubs + image, public | Création des `Gym` sans saisie manuelle |

Pas encore exposé par le package : journal de progression des séances et affluence des clubs. Vérifie le dépôt avant la Phase 4 ; si une PR upstream est simple, propose-la.

**Machines et exercices** — source principale : l'API REST de wger (`/api/v2/exerciseinfo/`), environ 845 exercices avec muscles, équipement, images et licences (données CC-BY-SA, attribution obligatoire dans l'app). Une commande `import_exercises` les synchronise en base. Les machines guidées propres aux salles (presse, poulies, leg extension…) sont ajoutées comme `Equipment` maison, chaque club pouvant être annoté par l'utilisateur (« présent dans ma salle »). Alternative de secours : free-exercise-db (JSON en domaine public).

**Règles d'implémentation**

- Nouvelle app `integrations/basicfit/` : adaptateur `BasicFitGateway` (seul point de contact avec le package), DTO internes, mapping vers nos modèles ; aucun autre module n'importe `basicfit`.
- Connexion : flux OAuth2 PKCE fourni par le package. La page de login Basic-Fit est protégée par un anti-bot, donc l'utilisateur se connecte dans son navigateur puis colle l'URL de redirection ; l'écran l'explique clairement.
- Les refresh tokens Basic-Fit tournent à chaque appel : persister le nouveau jeu via le callback `token_updated`, chiffré en base (`django-cryptography` ou Fernet avec clé en variable d'environnement), jamais loggé.
- Synchronisation via tâche Celery (au plus une fois par heure par utilisateur, backoff exponentiel), déclenchable manuellement ; gestion des exceptions `BasicFitAuthError` (reconnexion demandée) et `BasicFitAPIError`.
- Tests avec réponses enregistrées (fixtures JSON) ; aucun appel réseau réel en CI.
- Feature flag `BASICFIT_ENABLED` : l'app reste entièrement utilisable sans.
- Risques à afficher dans l'ADR : API non officielle pouvant casser ou être contraire aux CGU Basic-Fit, usage limité au compte personnel ; paquet sans provenance PyPI, donc version épinglée par hash et code relu avant chaque mise à jour.

## Stack et architecture

Versions : prends les dernières stables au moment de l'init et épingle-les (lockfiles). Justifie tout ajout de dépendance dans la PR.

**Back-end**

- Python 3.13+, Django 5.x LTS si disponible, gestion des dépendances avec `uv`.
- API REST avec Django REST Framework (ou Django Ninja si tu argumentes), schéma OpenAPI généré par `drf-spectacular`.
- PostgreSQL 17, Redis pour cache et file de tâches (Celery ou `django-tasks`) : import d'aliments, recalcul des records, export.
- Authentification : JWT avec refresh token rotatif, via djangorestframework-simplejwt (le package JWT Django le plus utilisé, v5.5.1 en juin 2026) et dj-rest-auth pour les endpoints (login, logout, inscription, reset, MFA TOTP, passkeys). Réglages : access 5–15 min, refresh 7–30 jours, ROTATE\_REFRESH\_TOKENS et BLACKLIST\_AFTER\_ROTATION activés avec l'app token\_blacklist, JWT\_AUTH\_HTTPONLY pour que les tokens ne soient jamais dans le corps de réponse, cookie refresh limité au chemin /api/v1/auth/token/refresh/, CSRF sur refresh et logout. Côté Next.js, un route handler proxy appelle le refresh sur 401 et rejoue la requête une seule fois (verrou contre les refresh concurrents). Une future app native recevra le refresh en stockage sécurisé (Keychain/Keystore) via un endpoint dédié. ADR 0001 documente ce choix. Pas de token dans `localStorage`.
- Architecture en couches par app : `models` → `selectors` (lectures) → `services` (écritures, règles métier, transactions) → `api` (serializers + views minces). Aucune logique métier dans les views ou serializers.
- Settings par environnement (`base`, `dev`, `test`), config via variables d'environnement (`django-environ`), aucun secret commité.

**Front-end**

- Next.js (App Router) + React + TypeScript strict, `pnpm`.
- Client API typé généré depuis l'OpenAPI (`openapi-typescript` + `openapi-fetch` ou Orval) : jamais de types écrits à la main pour l'API.
- TanStack Query pour l'état serveur, mises à jour optimistes et cache hors ligne ; Zod pour la validation des formulaires (React Hook Form).
- Styles : Tailwind CSS v4 avec design tokens maison, primitives accessibles Radix UI ou React Aria ; shadcn/ui seulement comme point de départ, restylé entièrement.
- Graphiques : Visx ou Recharts, toujours avec une alternative texte/tableau.
- PWA : manifest, service worker (Serwist), file d'attente hors ligne des séries.
- Organisation *feature-sliced* : `app/` (routes), `features/<domaine>/` (composants, hooks, schémas), `shared/` (ui, lib, api).

**Flux** : navigateur → Next.js (SSR + proxy `/api`) → Django API → PostgreSQL / Redis ; worker Celery consomme Redis.

## Infra Docker de développement

Objectif : `make up` lance tout, et chaque modification de code est visible immédiatement sans rebuild. Pas de déploiement pour l'instant, mais les Dockerfiles doivent déjà avoir une cible `prod` propre pour plus tard.

Services `compose.yaml` :

| Service | Image / build | Rôle en dev |
| --- | --- | --- |
| `db` | `postgres:17-alpine` | Volume nommé, healthcheck `pg_isready` |
| `redis` | `redis:7-alpine` | Cache + broker |
| `api` | `backend/Dockerfile` cible `dev` | `runserver 0.0.0.0:8000`, code monté en volume, attend `db` healthy |
| `worker` | même image que `api` | Celery avec rechargement auto (`watchfiles`) |
| `web` | `frontend/Dockerfile` cible `dev` | `next dev --turbopack`, `node_modules` dans un volume anonyme |
| `mailpit` | `axllent/mailpit` | Capture des e-mails (reset mot de passe) |
| `proxy` (option) | Caddy | Un seul domaine `localhost` pour front + `/api` |

Exigences :

- Dockerfiles multi-stage (`base` → `dev` → `build` → `prod`), images slim, utilisateur non-root, pas de secrets en `ARG`.
- Hot reload fiable sous Docker Desktop : utilise `develop.watch` de Compose (`sync` pour le code, `rebuild` pour les lockfiles) en plus ou à la place des bind mounts ; active `WATCHPACK_POLLING` seulement si nécessaire.
- `.env.example` complet et documenté ; `.env` ignoré par git.
- `Makefile` (ou `justfile`) : `up`, `down`, `logs`, `sh-api`, `migrate`, `makemigrations`, `seed`, `test`, `lint`, `fmt`, `typegen` (régénère le client TS depuis l'OpenAPI), `reset-db`.
- Commande `seed` : un utilisateur démo, une bibliothèque d'environ 150 exercices (groupes musculaires, équipement), 8 semaines de séances et de poids réalistes pour développer les graphiques.
- Option devcontainer (`.devcontainer/`) pour ouvrir le projet dans VS Code avec les outils préinstallés.

## Structure du repo et conventions

Monorepo unique, lisible en 30 secondes par un recruteur ou un relecteur :

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
├── compose.yaml Makefile .env.example .pre-commit-config.yaml
├── CLAUDE.md README.md SECURITY.md CONTRIBUTING.md LICENSE
```

Conventions :

- **Commits** Conventional Commits (`feat(training): …`), vérifiés par commitlint ; branches `feat/`, `fix/`, `chore/` ; `main` protégée, squash merge.
- **Python** : Ruff (lint + format), mypy strict avec `django-stubs`, typage complet, docstrings sur les services publics.
- **TypeScript** : `strict: true`, ESLint (flat config, `jsx-a11y`, `react-hooks`), Prettier ou Biome, pas de `any`.
- **API** : versionnée `/api/v1/`, erreurs au format RFC 9457 (`problem+json`), pagination par curseur, noms au pluriel.
- **Décisions** : toute décision structurante = un ADR court (contexte, options, choix, conséquences).
- **README** : pitch, captures, schéma d'archi, démarrage en 3 commandes, choix techniques et pourquoi.

## Qualité, tests et pipeline CI sécurisé

Une PR ne fusionne que si tous les jobs ci-dessous sont verts. Les mêmes vérifications tournent en local via `pre-commit`.

**Tests**

- Back : pytest + pytest-django + factory-boy, couverture ≥ 85 % sur `services` et `selectors`, tests de permissions par endpoint (un utilisateur B ne lit jamais les données de A).
- Front : Vitest + Testing Library (composants, hooks), MSW pour mocker l'API.
- E2E : Playwright sur les parcours critiques (inscription, enregistrer une séance, ajouter un repas, voir la courbe de poids), en viewport mobile et desktop, avec `@axe-core/playwright` sur chaque page.
- Contrat : le schéma OpenAPI commité doit être identique à celui généré (échec si drift).

**GitHub Actions** (un workflow par responsabilité)

| Job | Outils | Bloquant |
| --- | --- | --- |
| Lint & types | Ruff, mypy, ESLint, `tsc --noEmit`, commitlint | Oui |
| Tests back | pytest avec services Postgres/Redis | Oui |
| Tests front | Vitest, build Next.js | Oui |
| E2E + a11y | Playwright + axe sur la stack Compose | Oui |
| SAST | CodeQL (Python + JS/TS), Semgrep, Bandit | Oui sur sévérité haute |
| Secrets | Gitleaks (pre-commit + CI) | Oui |
| Dépendances | `pip-audit`, `pnpm audit`, Dependabot / Renovate | Oui sur critique |
| Conteneurs | Hadolint, Trivy (image + config), SBOM Syft | Oui sur critique |
| Django | `manage.py check --deploy` sur settings prod, `makemigrations --check` | Oui |
| Lighthouse CI | Performance, a11y ≥ 95, bonnes pratiques | Avertissement |

**Durcissement du pipeline**

- `permissions: contents: read` par défaut, élargi job par job.
- Actions tierces épinglées par SHA de commit, mises à jour par Dependabot.
- Pas de `pull_request_target` sur du code non fiable ; secrets absents des PR de forks.
- `step-security/harden-runner` en mode audit, cache des dépendances par lockfile.
- Branche `main` protégée : revue obligatoire, checks requis, commits signés, historique linéaire.
- OpenSSF Scorecard en job hebdomadaire.

**Sécurité applicative** (référentiel OWASP ASVS niveau 2)

- Argon2 pour les mots de passe, limitation de débit sur login et reset, verrouillage progressif.
- En-têtes : CSP stricte avec nonce côté Next.js, HSTS (prêt pour prod), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- CORS restreint, cookies `Secure` / `HttpOnly` / `SameSite=Lax`, CSRF actif.
- Uploads de photos : type MIME vérifié, EXIF supprimé (géolocalisation), stockage privé, URL signées.
- Journaux sans données de santé ni PII ; `SECURITY.md` décrit la divulgation responsable.

## Design, accessibilité et ergonomie

L'interface ne doit pas ressembler à un template généré par IA. Avant tout composant, propose 2 ou 3 directions visuelles (moodboard textuel, palette, typographies, un écran clé) et attends mon choix ; consigne-le dans `docs/design-system.md`.

**À éviter explicitement** : dégradés violet-bleu, glassmorphism partout, cartes arrondies identiques en grille, police Inter par défaut, icônes emoji, illustrations 3D génériques, textes « Unlock your potential ».

**Direction attendue** : un caractère affirmé et cohérent avec l'univers « salle de sport » (par exemple carnet d'entraînement éditorial, ou instrument de mesure technique), une typographie d'affichage distinctive + une police lisible pour les chiffres (chiffres tabulaires), une couleur d'accent unique, mode sombre soigné par défaut (salle peu éclairée), micro-interactions sobres respectant `prefers-reduced-motion`.

**Design system**

- Tokens (couleurs, espacements, rayons, ombres, typo, durées) définis une fois en CSS custom properties, consommés par Tailwind.
- Composants documentés dans Storybook avec l'addon a11y ; tests visuels de régression (Playwright screenshots ou Chromatic).

**Accessibilité — WCAG 2.2 AA minimum (RGAA 4.1 compatible)**

- Contrastes ≥ 4,5:1 (texte) et 3:1 (éléments d'interface), dans les deux thèmes.
- Navigation complète au clavier, focus visible, ordre logique, liens d'évitement.
- Cibles tactiles ≥ 44 × 44 px, aucune action uniquement au geste.
- HTML sémantique d'abord, ARIA seulement si nécessaire ; formulaires avec labels, erreurs annoncées (`aria-live`).
- Graphiques : résumé textuel + tableau de données accessible, jamais la couleur seule pour porter le sens.
- Zoom 200 % et texte agrandi sans perte, langue `fr` déclarée, i18n prête (next-intl).

**Ergonomie mobile (usage en salle)**

- Actions principales dans la zone du pouce (barre d'onglets en bas, bouton « + Série » fixe).
- Pré-remplissage avec la dernière charge, pas de +/- 2,5 kg, minuteur de repos avec vibration.
- Écran maintenu allumé pendant la séance (Wake Lock API), états vides, chargement et erreur toujours conçus.
- Heuristiques de Nielsen vérifiées à chaque nouvel écran ; performance : LCP < 2,5 s, INP < 200 ms sur mobile milieu de gamme.

## Skills et outils Claude Code à utiliser

Utilise ces skills, plugins et serveurs MCP quand ils sont installés ; s'il en manque un, dis-le et propose de l'ajouter plutôt que de t'en passer en silence.

| Outil | Type | Quand l'utiliser |
| --- | --- | --- |
| `frontend-design` | Skill / plugin Anthropic | Avant tout écran : direction visuelle distinctive, typo, éviter l'esthétique « IA générique » |
| `webapp-testing` | Skill Anthropic | Piloter l'app avec Playwright, capturer des écrans, vérifier le rendu réel après chaque UI |
| Playwright MCP | Serveur MCP | Regarder la page en vrai (mobile + desktop), lancer axe, lire la console |
| Context7 | Serveur MCP | Documentation à jour de Django, DRF, Next.js, TanStack Query avant d'écrire du code d'API |
| GitHub MCP / `gh` | Serveur MCP / CLI | Issues, PR, lecture des résultats de CI |
| `/security-review` | Commande intégrée | Avant chaque PR touchant auth, uploads, permissions ou données de santé |
| `security-guidance` | Plugin | Alertes en temps réel sur les motifs dangereux pendant l'édition |
| `code-review` / `pr-review-toolkit` | Plugins | Revue multi-angle de la PR (tests, types, erreurs silencieuses, simplification) |
| `feature-dev` | Plugin | Exploration → architecture → implémentation guidée pour chaque nouveau domaine |
| `commit-commands` | Plugin | Commits conventionnels et ouverture de PR |
| `skill-creator` | Skill Anthropic | Créer des skills propres au projet (ci-dessous) |

**Skills projet à créer** dans `.claude/skills/` :

- `django-domain-app` : génère une app conforme (models, selectors, services, api, tests, admin) ;
- `lest-ui` : rappelle tokens, composants existants et checklist a11y avant tout composant ;
- `adr` : rédige un ADR au format du projet.

**Sous-agents** dans `.claude/agents/` : `a11y-auditor` (WCAG 2.2, lecture seule), `security-reviewer` (OWASP ASVS), `test-writer` (cas limites et permissions).

**Hooks** dans `.claude/settings.json` : Ruff + mypy après édition d'un `.py`, ESLint + `tsc` après un `.ts(x)`, blocage de toute écriture dans `.env*` ou de commandes `git push --force`.

## Roadmap et règles de travail

Chaque phase se termine par une démo fonctionnelle sur `localhost`, CI verte et README à jour.

1. **Phase 0 — Socle** : monorepo, Compose avec hot reload, Django + Next.js « hello » reliés, pre-commit, CI complète (même sur un projet vide), `CLAUDE.md`, ADR 0001 (auth).
2. **Phase 1 — Comptes & design system** : directions visuelles → choix → tokens, Storybook, auth, profil, onboarding (objectif, poids de départ).
3. **Phase 2 — Musculation** : import wger + équipements de salle, séance en cours, séries, minuteur, historique, records.
4. **Phase 3 — Corps & nutrition** : poids et moyenne mobile, mensurations, photos, journal alimentaire, Open Food Facts, objectifs macros.
5. **Phase 4 — Autres sports & insights** : activités génériques, connexion Basic-Fit (visites, pesées, clubs, recettes), tableau de bord, graphiques accessibles.
6. **Phase 5 — Mobile** : PWA installable, hors ligne + synchronisation, notifications. Option ultérieure : app native Expo réutilisant le client API typé.

**Règles de travail pour toi, Claude**

- Commence chaque tâche par un plan court (fichiers touchés, risques, tests prévus) et attends ma validation pour tout ce qui est structurant.
- TDD sur la logique métier : test rouge → code → refactor.
- Petites PR (< 400 lignes hors fichiers générés), une intention par PR, description avec captures pour l'UI.
- Après chaque changement d'UI, ouvre la page avec Playwright, fais une capture mobile et desktop, lance axe, corrige avant de me rendre la main.
- Ne désactive jamais un test, une règle de lint ou un contrôle de sécurité pour passer la CI ; explique le problème à la place.
- Quand tu hésites entre deux options, présente-les en 3 lignes avec ta recommandation.
- Tiens `CLAUDE.md` à jour (commandes, conventions, décisions) à chaque fin de phase.

**Définition de « terminé »** : tests et CI verts, aucune alerte de sécurité haute, a11y axe sans violation, types générés à jour, documentation et ADR écrits, démo visible sur le serveur de dev.

## Sources

- [basicfit sur PyPI](https://pypi.org/project/basicfit/)
- [dj-rest-auth (GitHub)](https://github.com/iMerica/dj-rest-auth)
- [Comparatif des packages JWT Django](https://djangopackages.org/grids/g/jwt/packages/)
- [API d'exercices wger](https://wger.de/api/v2/exerciseinfo/)
