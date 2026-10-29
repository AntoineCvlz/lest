"""Vues MFA d'allauth durcies : retirer ou révéler un second facteur exige un second facteur.

allauth se contente d'une réauthentification récente, quelle qu'elle soit : avec une session
ouverte et le mot de passe (vu par-dessus l'épaule), on pourrait désactiver la double
authentification ou lire les codes de secours. Ces vues remplacent celles d'allauth sur les mêmes
URL (`config/urls.py`, montées avant `allauth.headless.urls`).
"""

from datetime import UTC, datetime
from typing import Any, cast

from allauth.account.authentication import get_authentication_records
from allauth.core.exceptions import ReauthenticationRequired
from allauth.headless.mfa.views import ManageRecoveryCodesView, ManageTOTPView
from allauth.mfa.models import Authenticator
from django.http import HttpRequest, HttpResponse


def require_second_factor_confirmation(request: HttpRequest) -> None:
    """Lève `ReauthenticationRequired` (401, parcours `mfa_reauthenticate`) si la dernière
    confirmation de la session n'a pas prouvé le second facteur.

    Exception : l'application activée après la dernière confirmation. Son premier code, saisi
    juste après le mot de passe, prouve déjà sa possession (affichage des codes de secours à
    l'activation). La fraîcheur de la confirmation reste vérifiée par allauth.
    """
    user = request.user
    totp = Authenticator.objects.filter(user=user.pk, type=Authenticator.Type.TOTP).first()
    if totp is None:
        return
    confirmations = [r for r in get_authentication_records(request) if r.get("reauthenticated")]
    if not confirmations:
        raise ReauthenticationRequired
    last = confirmations[-1]
    if last.get("method") == "mfa":
        return
    if totp.created_at > datetime.fromtimestamp(last["at"], tz=UTC):
        return
    raise ReauthenticationRequired


class SecondFactorTOTPView(ManageTOTPView):
    def delete(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().delete(request, *args, **kwargs))


class SecondFactorRecoveryCodesView(ManageRecoveryCodesView):
    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().get(request, *args, **kwargs))

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().post(request, *args, **kwargs))
