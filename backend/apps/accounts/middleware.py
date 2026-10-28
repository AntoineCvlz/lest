from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

from common.problems import problem_response

# Route d'allauth qui accepte aussi GET pour « consulter » un code de réinitialisation. Ce GET
# ne compte les essais que pour un compte existant : comparer les réponses après quelques appels
# révèle qu'une adresse est inscrite. Le front n'utilise que POST (code + nouveau mot de passe).
RESET_LOOKUP_ROUTE = "/api/v1/auth/app/v1/auth/password/reset"


class RefusePasswordResetLookupMiddleware:
    """Répond 405 à tout GET/HEAD sur la réinitialisation, avant d'atteindre allauth."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if request.method in {"GET", "HEAD"} and request.path.rstrip("/") == RESET_LOOKUP_ROUTE:
            response = problem_response(request, status=405)
            response["Allow"] = "POST"
            return response
        return self.get_response(request)
