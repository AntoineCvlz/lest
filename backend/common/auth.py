"""Authentification de l'API : JWT d'allauth (ADR 0001), exigé par défaut sur toutes les routes."""

from allauth.headless.contrib.ninja.security import JWTTokenAuth
from django.http import HttpRequest

from apps.accounts.models import User


class BearerJWTAuth(JWTTokenAuth):
    """
    `JWTTokenAuth` d'allauth, documenté dans l'OpenAPI comme un schéma `Bearer` standard.

    Validation déléguée à allauth : signature RS256, expiration, session encore ouverte
    (déconnexion, changement de mot de passe, compte désactivé → 401).
    """

    openapi_type = "http"
    openapi_scheme = "bearer"


jwt_auth = BearerJWTAuth()


def request_user(request: HttpRequest) -> User:
    """
    Utilisateur authentifié par `jwt_auth` ; à appeler seulement sur une route protégée.

    `request.user` seul ne suffit pas : le middleware de session le remplit aussi depuis le
    cookie de l'admin. On exige donc la charge utile du JWT validée par Ninja (`request.auth`).
    """
    user = request.user
    payload = getattr(request, "auth", None)
    if (
        not isinstance(user, User)
        or not isinstance(payload, dict)
        or payload.get("sub") != str(user.pk)
    ):
        raise TypeError("request_user() appelé sans utilisateur authentifié par JWT.")
    return user
