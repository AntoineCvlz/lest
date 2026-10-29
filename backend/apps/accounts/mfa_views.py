"""Vues MFA d'allauth durcies : dès qu'un compte a un second facteur, en ajouter, en retirer ou
révéler les codes de secours exige un second facteur.

allauth se contente d'une réauthentification récente, quelle qu'elle soit : avec une session
ouverte et le mot de passe (vu par-dessus l'épaule), on pourrait désactiver la double
authentification, lire les codes de secours ou ajouter sa propre passkey (accès durable sans le
second facteur). Ces vues remplacent celles d'allauth sur les mêmes URL (`config/urls.py`,
montées avant `allauth.headless.urls`).
"""

from datetime import UTC, datetime
from typing import Any, cast

from allauth.account.authentication import get_authentication_records
from allauth.core.exceptions import ReauthenticationRequired
from allauth.headless.mfa.views import (
    ManageRecoveryCodesView,
    ManageTOTPView,
    ManageWebAuthnView,
)
from allauth.mfa.models import Authenticator
from django.http import HttpRequest, HttpResponse

# Facteurs qui protègent la connexion ; les codes de secours n'en sont que la roue de secours.
FACTOR_TYPES = (Authenticator.Type.TOTP, Authenticator.Type.WEBAUTHN)


def require_second_factor_confirmation(request: HttpRequest) -> None:
    """Lève `ReauthenticationRequired` (401, parcours `mfa_reauthenticate`) si le compte a un
    facteur et que la dernière confirmation de la session n'a pas prouvé un second facteur.

    Exception : un facteur ajouté après la dernière confirmation. Le premier facteur s'ajoute
    avec le mot de passe (aucun n'existait), et son ajout a prouvé sa possession : les codes de
    secours restent affichables juste après l'activation. La fraîcheur de la confirmation reste
    vérifiée par allauth.
    """
    factors = Authenticator.objects.filter(user=request.user.pk, type__in=FACTOR_TYPES)
    newest = factors.order_by("-created_at").values_list("created_at", flat=True).first()
    if newest is None:
        return
    confirmations = [r for r in get_authentication_records(request) if r.get("reauthenticated")]
    if not confirmations:
        raise ReauthenticationRequired
    last = confirmations[-1]
    if last.get("method") == "mfa":
        return
    if newest > datetime.fromtimestamp(last["at"], tz=UTC):
        return
    raise ReauthenticationRequired


class SecondFactorTOTPView(ManageTOTPView):
    # GET propose un secret à activer : c'est le début d'un ajout de facteur.
    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().get(request, *args, **kwargs))

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().post(request, *args, **kwargs))

    def delete(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().delete(request, *args, **kwargs))


class SecondFactorWebAuthnView(ManageWebAuthnView):
    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().get(request, *args, **kwargs))

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().post(request, *args, **kwargs))

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
