"""Réponses d'erreur au format RFC 9457 (`application/problem+json`).

Toutes les erreurs de l'API passent par ici : un format unique côté client, et aucune
fuite d'information (pas de trace, pas de valeurs saisies renvoyées dans les erreurs).
"""

import json
import logging
from http import HTTPStatus
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404, HttpRequest, HttpResponse
from django.views.defaults import page_not_found
from ninja import NinjaAPI
from ninja.errors import AuthenticationError, HttpError, ValidationError

logger = logging.getLogger(__name__)

PROBLEM_CONTENT_TYPE = "application/problem+json"
API_PATH_PREFIX = "/api/"


def problem_response(
    request: HttpRequest,
    *,
    status: int,
    detail: str | None = None,
    title: str | None = None,
    type_: str = "about:blank",
    **extensions: Any,
) -> HttpResponse:
    """Construit une réponse `problem+json` ; `title` vaut par défaut la phrase HTTP standard."""
    body: dict[str, Any] = {
        "type": type_,
        "title": title or HTTPStatus(status).phrase,
        "status": status,
    }
    if detail:
        body["detail"] = detail
    body["instance"] = request.path
    body.update(extensions)
    return HttpResponse(json.dumps(body), status=status, content_type=PROBLEM_CONTENT_TYPE)


# Signature imposée par `NinjaAPI.add_exception_handler` ; en pratique, Ninja passe une instance.
type _Exc[E: Exception] = E | type[E]


def _sanitize_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # On ne renvoie jamais `input` ni `ctx` : ils peuvent contenir des données de santé saisies.
    return [
        {"loc": e.get("loc", []), "msg": e.get("msg", ""), "type": e.get("type", "")}
        for e in errors
    ]


def _on_not_found(request: HttpRequest, exc: _Exc[Http404]) -> HttpResponse:
    return problem_response(request, status=404)


class ProblemError(HttpError):
    """`HttpError` avec un type RFC 9457 propre, que le client peut distinguer sans lire le texte
    (ex. « mot de passe incorrect » parmi d'autres 403)."""

    def __init__(self, status_code: int, message: str, *, type_: str) -> None:
        super().__init__(status_code, message)
        self.type_ = type_


def _on_http_error(request: HttpRequest, exc: _Exc[HttpError]) -> HttpResponse:
    if isinstance(exc, ProblemError):
        return problem_response(
            request, status=exc.status_code, detail=exc.message, type_=exc.type_
        )
    if isinstance(exc, HttpError):
        return problem_response(request, status=exc.status_code, detail=exc.message)
    return problem_response(request, status=500)


def _on_validation_error(request: HttpRequest, exc: _Exc[ValidationError]) -> HttpResponse:
    errors = exc.errors if isinstance(exc, ValidationError) else []
    return problem_response(
        request,
        status=422,
        detail="La requête contient des données invalides.",
        errors=_sanitize_validation_errors(errors),
    )


def _on_domain_validation_error(
    request: HttpRequest, exc: _Exc[DjangoValidationError]
) -> HttpResponse:
    # Erreur levée par un service (`full_clean`, règle métier) : champs et codes seulement. Les
    # messages de Django reprennent la valeur saisie (donnée de santé) : ni renvoyés ni journalisés.
    errors: list[dict[str, Any]] = []
    if isinstance(exc, DjangoValidationError):
        by_field = exc.error_dict if hasattr(exc, "error_dict") else {"__all__": exc.error_list}
        errors = [
            {"loc": [field], "type": error.code or "invalid"}
            for field, field_errors in by_field.items()
            for error in field_errors
        ]
    return problem_response(
        request, status=422, detail="La requête contient des données invalides.", errors=errors
    )


def _on_authentication_error(request: HttpRequest, exc: _Exc[AuthenticationError]) -> HttpResponse:
    return problem_response(request, status=401)


def _on_unhandled(request: HttpRequest, exc: _Exc[Exception]) -> HttpResponse:
    # La trace part dans les journaux, jamais dans la réponse.
    logger.exception("Unhandled API error on %s %s", request.method, request.path)
    return problem_response(request, status=500)


def register_problem_handlers(api: NinjaAPI) -> None:
    """Remplace les gestionnaires d'erreurs par défaut de Ninja par des réponses RFC 9457."""
    api.add_exception_handler(Http404, _on_not_found)
    api.add_exception_handler(HttpError, _on_http_error)
    api.add_exception_handler(ValidationError, _on_validation_error)
    api.add_exception_handler(DjangoValidationError, _on_domain_validation_error)
    api.add_exception_handler(AuthenticationError, _on_authentication_error)
    api.add_exception_handler(Exception, _on_unhandled)


def handler404(request: HttpRequest, exception: Exception) -> HttpResponse:
    """404 Django : `problem+json` pour les routes inconnues sous `/api/`, page HTML ailleurs."""
    if request.path.startswith(API_PATH_PREFIX):
        return problem_response(request, status=404)
    return page_not_found(request, exception)
