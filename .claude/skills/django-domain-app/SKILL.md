---
name: django-domain-app
description: Crée ou étend une app Django de domaine de Lest (accounts, training, nutrition, body…) selon les conventions du projet — models, selectors, services, api Ninja, admin, tests et fabriques — en TDD et avec isolation stricte entre utilisateurs. À utiliser pour toute nouvelle app ou nouvelle entité côté back.
---

# App de domaine Django

Référence vivante : `backend/apps/accounts/`. Contraintes : `CLAUDE.md` (domaines, couches,
règles métier) et `docs/architecture.md`.

## Structure

```text
backend/apps/<domaine>/
├── __init__.py
├── apps.py            # name = "apps.<domaine>", label = "<domaine>", verbose_name en français
├── models.py          # données et invariants simples (contraintes en base)
├── selectors.py       # LECTURES : toujours filtrées par propriétaire
├── services.py        # ÉCRITURES et règles métier, dans des transactions
├── api/               # schémas Pydantic + router Ninja MINCES (aucune logique métier)
├── admin.py
├── migrations/
└── tests/
    ├── factories.py   # factory-boy + fonctions typées make_<entité>() -> Modèle
    └── test_*.py
```

Puis : ajouter `"apps.<domaine>"` à `INSTALLED_APPS`, monter le router dans `config/api.py`,
`just makemigrations`, `just typegen` si l'API change.

## Règles

- **Pas d'import croisé de modèles** entre domaines : passer par le service ou le selector de
  l'autre domaine, ou par un signal de domaine.
- **Propriétaire partout** : chaque selector prend l'utilisateur en paramètre et filtre dessus ;
  un objet d'un autre utilisateur est introuvable (404, jamais 403 : ne pas révéler qu'il existe).
- **Identifiants exposés** : UUID (non énumérables), comme `User`.
- **Unités SI** en base (kg, m, s) ; conversion seulement à l'affichage.
- **Contraintes en base** (`UniqueConstraint`, `CheckConstraint`) pour les invariants, pas
  seulement du code de validation.
- **Services** : signatures typées et mot-clé seulement (`*`), docstring, `transaction.atomic()`
  dès plusieurs écritures, erreurs métier explicites (traduites en RFC 9457 par l'API).
- **Données de santé** : minimisation ; jamais dans les journaux ; champs sensibles chiffrés.
- Données minimales : ne pas ajouter de champ « au cas où ».

## Tests (TDD : test rouge, code, refactor)

- pytest-django, `pytestmark = pytest.mark.django_db` ; données via `make_<entité>()`.
- Pour **chaque** selector et endpoint : un test d'**isolation** (l'utilisateur B ne lit, ne
  liste, ne modifie ni ne supprime les objets de A).
- Règles métier de CLAUDE.md quand elles sont touchées (volume hors échauffement, records…).
- Couverture ≥ 85 % sur `services` et `selectors` (seuil appliqué par `pytest --cov`).
- Contraintes en base testées en contournant le service (`Model.objects.create`) dans
  `transaction.atomic()`.

## Typage (mypy strict)

- factory-boy n'est que partiellement typé : l'exception mypy est limitée à
  `apps.*.tests.factories` ; le reste des tests utilise les fonctions typées `make_*()`.
- Classes génériques des stubs non indexables à l'exécution (ex. `UserAdmin`) : alias sous
  `if TYPE_CHECKING:` plutôt que `django-stubs-ext` en production.

## Avant la PR

`just lint`, `just test`, `makemigrations --check` ; `/security-review` si l'app touche aux
données de santé, à l'authentification ou aux permissions ; agent `test-writer` pour les cas
limites d'isolation.
