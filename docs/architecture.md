# Architecture

Vue d'ensemble selon le modèle [C4](https://c4model.com) : contexte (niveau 1) puis conteneurs
(niveau 2). Les décisions structurantes sont dans [`adr/`](adr/).

## Niveau 1 — Contexte

```mermaid
flowchart LR
    user(["Pratiquant·e<br/>(mobile en salle, desktop)"])
    lest["Lest<br/>suivi musculation, corps, nutrition, sports"]
    off[("Open Food Facts<br/>aliments, codes-barres")]
    wger[("wger<br/>catalogue d'exercices, CC-BY-SA")]
    bf[("API Basic-Fit<br/>non officielle, optionnelle")]
    mail[("Serveur SMTP<br/>e-mails de compte")]

    user -- "HTTPS (PWA)" --> lest
    lest -- "recherche, scan" --> off
    lest -- "import_exercises" --> wger
    lest -. "visites, pesées, clubs<br/>(BASICFIT_ENABLED)" .-> bf
    lest -- "vérification, reset" --> mail
```

## Niveau 2 — Conteneurs

```mermaid
flowchart TB
    browser(["Navigateur / PWA"])

    subgraph lest["Lest"]
        web["web — Next.js 16 (App Router)<br/>SSR, CSP à nonce, proxy /api (BFF)"]
        api["api — Django 5.2 + Ninja<br/>/api/v1, allauth headless (JWT)"]
        worker["worker — Celery<br/>imports, recalculs, synchro Basic-Fit"]
        db[("db — PostgreSQL 17")]
        redis[("redis — Redis 7<br/>cache + broker")]
    end

    browser -- "HTTPS, cookies HttpOnly" --> web
    web -- "HTTP interne, Authorization: Bearer" --> api
    api --> db
    api --> redis
    worker -- "tâches" --> redis
    worker --> db
```

| Conteneur | Responsabilité | Code |
| --- | --- | --- |
| `web` | Pages, rendu serveur, en-têtes de sécurité, **seul point d'entrée du navigateur** ; garde les jetons côté serveur (ADR 0001) | `frontend/` |
| `api` | Règles métier (`services`), lectures (`selectors`), API Ninja mince ; une app par domaine | `backend/` |
| `worker` | Traitements asynchrones et planifiés | `backend/` (Celery) |
| `db` | Données ; filtrage par propriétaire systématique | — |
| `redis` | Cache et file de tâches | — |

## Flux d'une requête

1. Le navigateur appelle `https://…/api/v1/…` sur la **même origine** que les pages.
2. `web` (route `/api/[...path]`) n'autorise que `/api/v1/*`, filtre les en-têtes et relaie vers `api`.
3. `api` authentifie (Phase 1), délègue aux `services` et `selectors`, et répond en JSON, ou en
   `application/problem+json` (RFC 9457) en cas d'erreur.

## Environnements

| | Dev (`just up`) | CI (E2E) | Prod (à venir) |
| --- | --- | --- | --- |
| Images | cible `dev`, code synchronisé (`develop.watch`) | cible `prod` (`compose.e2e.yaml`) | cible `prod` |
| Serveurs | `runserver`, `next dev` | gunicorn, Next standalone | gunicorn, Next standalone |
| CSP | assouplie (`unsafe-eval` pour React dev) | stricte | stricte |
