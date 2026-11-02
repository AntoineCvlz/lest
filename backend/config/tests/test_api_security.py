"""Garde-fou : toute route de l'API exige un JWT, sauf la liste blanche explicite ci-dessous."""

import pytest
from django.urls import URLResolver, get_resolver, resolve

from apps.accounts.mfa_views import (
    PasskeyReauthenticateView,
    PasswordlessLoginView,
    SecondFactorAuthenticateView,
    SecondFactorRecoveryCodesView,
    SecondFactorTOTPView,
    SecondFactorWebAuthnView,
)
from common.auth import jwt_auth
from config.api import api

PUBLIC_OPERATIONS = {
    ("GET", "/health/"),
    # Images du catalogue (ADR 0005) : publiques comme lui, nommées par leur empreinte.
    ("GET", "/exercise-images/{name}"),
}


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
        # Vues MFA d'allauth durcies, sur les URL d'allauth.
        "api/v1/auth/app/v1/account/authenticators/totp",
        "api/v1/auth/app/v1/account/authenticators/recovery-codes",
        "api/v1/auth/app/v1/account/authenticators/webauthn",
        "api/v1/auth/app/v1/auth/webauthn/login",
        "api/v1/auth/app/v1/auth/webauthn/authenticate",
        "api/v1/auth/app/v1/auth/webauthn/reauthenticate",
    }
    ninja = next(p for p in get_resolver().url_patterns if str(p.pattern) == "api/v1/")
    assert isinstance(ninja, URLResolver)
    assert ninja.app_name == api.urls[1]


AUTH = "/api/v1/auth/app/v1"


@pytest.mark.parametrize(
    ("url", "view"),
    [
        (f"{AUTH}/account/authenticators/totp", SecondFactorTOTPView),
        (f"{AUTH}/account/authenticators/webauthn", SecondFactorWebAuthnView),
        (f"{AUTH}/account/authenticators/recovery-codes", SecondFactorRecoveryCodesView),
        (f"{AUTH}/auth/webauthn/login", PasswordlessLoginView),
        (f"{AUTH}/auth/webauthn/authenticate", SecondFactorAuthenticateView),
        (f"{AUTH}/auth/webauthn/reauthenticate", PasskeyReauthenticateView),
    ],
)
def test_hardened_views_answer_before_allauth(url: str, view: type) -> None:
    # Les motifs seuls ne suffisent pas : la première route qui correspond doit être la nôtre.
    assert resolve(url).func.view_class is view  # type: ignore[attr-defined]
