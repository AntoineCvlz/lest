"""Point d'entrée unique de l'API v1 : chaque domaine y monte son router."""

from django.conf import settings
from ninja import NinjaAPI

from apps.accounts.api.router import router as accounts_router
from common.auth import jwt_auth
from common.health.api import router as health_router
from common.problems import register_problem_handlers

api = NinjaAPI(
    title="Lest API",
    version="1.0.0",
    urls_namespace="api-v1",
    docs_url="/docs/" if settings.DEBUG else None,
    # Toute route exige un JWT ; une route publique le déclare avec `auth=None`
    # (liste blanche vérifiée par `config/tests/test_api_security.py`).
    auth=jwt_auth,
)
register_problem_handlers(api)

api.add_router("/", health_router)
api.add_router("/", accounts_router)
