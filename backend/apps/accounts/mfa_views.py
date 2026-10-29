"""Vues MFA d'allauth durcies : dès qu'un compte a un second facteur, en ajouter, en retirer ou
révéler les codes de secours exige un second facteur.

allauth se contente d'une réauthentification récente, quelle qu'elle soit : avec une session
ouverte et le mot de passe (vu par-dessus l'épaule), on pourrait désactiver la double
authentification, lire les codes de secours ou ajouter sa propre passkey (accès durable sans le
second facteur). Ces vues remplacent celles d'allauth sur les mêmes URL (`config/urls.py`,
montées avant `allauth.headless.urls`).
"""

from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any, cast

from allauth.account.authentication import get_authentication_records
from allauth.core import ratelimit
from allauth.core.exceptions import ReauthenticationRequired
from allauth.headless.internal.restkit.response import ErrorResponse
from allauth.headless.mfa.views import (
    LoginWebAuthnView,
    ManageRecoveryCodesView,
    ManageTOTPView,
    ManageWebAuthnView,
)
from allauth.mfa.adapter import get_adapter
from allauth.mfa.models import Authenticator
from allauth.mfa.webauthn.internal.auth import parse_authentication_response
from django.http import HttpRequest, HttpResponse

# Facteurs qui protègent la connexion ; les codes de secours n'en sont que la roue de secours.
FACTOR_TYPES = (Authenticator.Type.TOTP, Authenticator.Type.WEBAUTHN)
# Facteurs ajoutés dans la session courante (`remember_factor_added`).
FACTORS_ADDED_SESSION_KEY = "lest_factors_added"
# Limite des demandes d'options de connexion par passkey (`ACCOUNT_RATE_LIMITS`).
PASSKEY_LOGIN_OPTIONS = "passkey_login_options"


def require_second_factor_confirmation(request: HttpRequest) -> None:
    """Lève `ReauthenticationRequired` (401, parcours `mfa_reauthenticate`) si le compte a un
    facteur et que la dernière confirmation de la session n'a pas prouvé un second facteur.

    Exception : tous les facteurs du compte ont été ajoutés dans cette session, après sa dernière
    confirmation. Le premier facteur s'ajoute avec le mot de passe (aucun n'existait), et son
    ajout a prouvé sa possession : les codes de secours restent affichables juste après
    l'activation. Liée à la session, l'exception ne profite pas à une autre session confirmée par
    mot de passe pendant que le titulaire ajoute un facteur. La fraîcheur de la confirmation reste
    vérifiée par allauth.
    """
    factors = list(
        Authenticator.objects.filter(user=request.user.pk, type__in=FACTOR_TYPES).values_list(
            "pk", "created_at"
        )
    )
    if not factors:
        return
    confirmations = [r for r in get_authentication_records(request) if r.get("reauthenticated")]
    if not confirmations:
        raise ReauthenticationRequired
    last = confirmations[-1]
    if last.get("method") == "mfa":
        return
    confirmed_at = datetime.fromtimestamp(last["at"], tz=UTC)
    added_here = set(request.session.get(FACTORS_ADDED_SESSION_KEY, []))
    if all(pk in added_here and created_at > confirmed_at for pk, created_at in factors):
        return
    raise ReauthenticationRequired


def remember_factor_added(request: HttpRequest, response: HttpResponse) -> HttpResponse:
    """Après un ajout réussi, note le facteur dans la session : seule celle-ci profite de
    l'exception de `require_second_factor_confirmation`. (Le signal `authenticator_added`
    d'allauth part après la transaction, trop tard ou jamais selon le contexte.)"""
    if response.status_code == HTTPStatus.OK:
        newest = (
            Authenticator.objects.filter(user=request.user.pk, type__in=FACTOR_TYPES)
            .order_by("-created_at")
            .values_list("pk", flat=True)
            .first()
        )
        added = request.session.get(FACTORS_ADDED_SESSION_KEY, [])
        request.session[FACTORS_ADDED_SESSION_KEY] = [*added, newest]
    return response


class SecondFactorTOTPView(ManageTOTPView):
    # GET propose un secret à activer : c'est le début d'un ajout de facteur.
    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().get(request, *args, **kwargs))

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return remember_factor_added(
            request, cast(HttpResponse, super().post(request, *args, **kwargs))
        )

    def delete(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().delete(request, *args, **kwargs))


class SecondFactorWebAuthnView(ManageWebAuthnView):
    def put(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        # Renommer : sans gain d'accès, mais un nom trompeur pousserait à retirer la bonne clé.
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().put(request, *args, **kwargs))

    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return cast(HttpResponse, super().get(request, *args, **kwargs))

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        require_second_factor_confirmation(request)
        return remember_factor_added(
            request, cast(HttpResponse, super().post(request, *args, **kwargs))
        )

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


class PasswordlessLoginView(LoginWebAuthnView):
    """Connexion sans mot de passe : seulement par une passkey, avec vérification de l'utilisateur.

    allauth demande la vérification (PIN, biométrie) en simple préférence : une clé enregistrée
    comme second facteur, sans vérification, connecterait sinon par la seule possession de
    l'objet. Le drapeau UV est signé par l'authentificateur, dans ses données d'authentification.
    """

    def get(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        # Chaque GET stocke un défi dans une nouvelle session : limité comme le POST (allauth
        # ne limite pas les GET).
        limited = ratelimit.consume_or_429(request, action=PASSKEY_LOGIN_OPTIONS, limit_get=True)
        if limited:
            return cast(HttpResponse, limited)
        return cast(HttpResponse, super().get(request, *args, **kwargs))

    def post(self, request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        authenticator = self.input.cleaned_data["credential"]
        assertion = parse_authentication_response(self.input.data.get("credential"))
        verified = assertion.response.authenticator_data.is_user_verified()
        # `is_passwordless` vient de `credProps`, non signé et parfois absent (`None`) : seul un
        # refus explicite écarte la clé ; le contrôle de sécurité est le drapeau UV, signé.
        if not verified or authenticator.wrap().is_passwordless is False:
            error = get_adapter().validation_error("incorrect_code")
            return cast(HttpResponse, ErrorResponse(request, exception=error))
        return cast(HttpResponse, super().post(request, *args, **kwargs))
