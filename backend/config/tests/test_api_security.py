"""Garde-fou : toute route de l'API exige un JWT, sauf la liste blanche explicite ci-dessous."""

from django.urls import URLResolver, get_resolver

from common.auth import jwt_auth
from config.api import api

PUBLIC_OPERATIONS = {("GET", "/health/")}


def test_jwt_is_documented_as_a_bearer_scheme() -> None:
    schemes = api.get_openapi_schema()["components"]["securitySchemes"]

    assert schemes == {"BearerJWTAuth": {"type": "http", "scheme": "bearer"}}


def test_every_operation_requires_the_jwt_unless_whitelisted() -> None:
    # Parcourt les opérations réellement montées (y compris `include_in_schema=False`) : les
    # routers « liés » portent l'authentification héritée de l'API, pas leurs modèles.
    unprotected = {
        (method, path)
        for router in api._get_bound_routers()
        for path, view in router.path_operations.items()
        for operation in view.operations
        if operation.auth_callbacks != [jwt_auth]
        for method in operation.methods
    }

    assert unprotected == PUBLIC_OPERATIONS


def test_only_allauth_ninja_and_hardened_mfa_views_are_mounted_under_the_api_prefix() -> None:
    mounted = {
        str(pattern.pattern)
        for pattern in get_resolver().url_patterns
        if str(pattern.pattern).startswith("api/")
    }

    assert mounted == {
        "api/v1/auth/",
        "api/v1/",
        # Vues MFA d'allauth durcies (second facteur exigé), sur les URL d'allauth.
        "api/v1/auth/app/v1/account/authenticators/totp",
        "api/v1/auth/app/v1/account/authenticators/recovery-codes",
    }
    ninja = next(p for p in get_resolver().url_patterns if str(p.pattern) == "api/v1/")
    assert isinstance(ninja, URLResolver)
    assert ninja.app_name == api.urls[1]
