"""Point d'entrée unique de l'API v1 : chaque domaine y monte son router."""

from django.conf import settings
from ninja import NinjaAPI

from common.health.api import router as health_router
from common.problems import register_problem_handlers

api = NinjaAPI(
    title="Lest API",
    version="1.0.0",
    urls_namespace="api-v1",
    docs_url="/docs/" if settings.DEBUG else None,
)
register_problem_handlers(api)

api.add_router("/", health_router)
