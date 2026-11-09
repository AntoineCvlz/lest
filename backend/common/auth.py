"""Authentification de l'API : JWT d'allauth (ADR 0001), exigé par défaut sur toutes les routes."""

from typing import Any

from allauth.headless.contrib.ninja.security import JWTTokenAuth
from django.http import HttpRequest

from apps.accounts.models import User
from common.problems import ProblemError

# Compte pour lequel une saisie a été faite. Une saisie hors ligne rejouée après un changement de
# compte dans le navigateur est refusée au lieu d'écrire chez l'autre (ADR 0015).
ACCOUNT_HEADER = "X-Lest-Account"
ACCOUNT_MISMATCH_TYPE = "urn:lest:problem:account-mismatch"


class BearerJWTAuth(JWTTokenAuth):
    """
    `JWTTokenAuth` d'allauth, documenté dans l'OpenAPI comme un schéma `Bearer` standard.

    Validation déléguée à allauth : signature RS256, expiration, session encore ouverte
    (déconnexion, changement de mot de passe, compte désactivé → 401).
    """

    openapi_type = "http"
    openapi_scheme = "bearer"

    def __call__(self, request: HttpRequest) -> Any:
        """Charge utile du JWT, ou `None` (401) ; 409 si `X-Lest-Account` nomme un autre compte."""
        payload = super().__call__(request)
        expected = request.headers.get(ACCOUNT_HEADER)
        if isinstance(payload, dict) and expected is not None and expected != payload.get("sub"):
            # Avant la route : rien n'est écrit. Ni l'identifiant reçu ni le vrai ne sont renvoyés.
            raise ProblemError(
                409, "Saisie faite avec un autre compte.", type_=ACCOUNT_MISMATCH_TYPE
            )
        return payload


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
