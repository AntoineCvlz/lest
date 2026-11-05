"""Connexion Basic-Fit (ADR 0014) : état, lien de connexion, URL de redirection collée,
déconnexion. Désactivée (`BASICFIT_ENABLED`), seules les lectures répondent (« désactivée »),
les écritures sont introuvables (404). Aucun jeton ne sort jamais de l'API."""

from datetime import date, datetime
from typing import Literal

from allauth.core import ratelimit
from django.http import Http404, HttpRequest
from ninja import Field, Query, Router, Schema, Status

from apps.accounts.models import User
from apps.integrations.basicfit import selectors, services, tasks
from common.auth import request_user
from common.period import Period
from common.problems import ProblemError

router = Router(tags=["basicfit"])

RATE_LIMITED_TYPE = "urn:lest:problem:rate-limited"
REFUSED_TYPE = "urn:lest:problem:basicfit-redirect-refused"
LOGIN_REFUSED_TYPE = "urn:lest:problem:basicfit-login-refused"
UNAVAILABLE_TYPE = "urn:lest:problem:basicfit-unavailable"
CONNECT_ACTION = "basicfit_connect"
TOO_SOON_TYPE = "urn:lest:problem:basicfit-too-soon"
NOT_CONNECTED_TYPE = "urn:lest:problem:basicfit-not-connected"


class ConnectionOut(Schema):
    enabled: bool
    status: Literal["disabled", "none", "connected", "expired"]
    connected_at: datetime | None
    last_sync_at: datetime | None
    last_error: str
    home_club: str


class VisitOut(Schema):
    date: date
    club: str


class SyncOut(Schema):
    queued: bool


class LoginOut(Schema):
    authorize_url: str


class RedirectIn(Schema):
    redirect_url: str = Field(min_length=1, max_length=services.MAX_REDIRECT_LENGTH)


def _connecting(request: HttpRequest) -> User:
    user = request_user(request)
    if ratelimit.consume_or_429(request, action=CONNECT_ACTION, user=user) is not None:
        raise ProblemError(429, "Trop de tentatives. Réessayez plus tard.", type_=RATE_LIMITED_TYPE)
    return user


def _view(owner: User) -> ConnectionOut:
    view = selectors.connection_view(owner=owner)
    return ConnectionOut.model_validate(view.__dict__)


@router.get("/basicfit/connection/", response=ConnectionOut, summary="État de la liaison")
def connection(request: HttpRequest) -> ConnectionOut:
    return _view(request_user(request))


@router.post("/basicfit/connection/start/", response=LoginOut, summary="Commencer la connexion")
def start(request: HttpRequest) -> LoginOut:
    try:
        url = services.start_login(owner=_connecting(request))
    except services.DisabledError as error:
        raise Http404 from error
    return LoginOut(authorize_url=url)


@router.post(
    "/basicfit/connection/complete/",
    response=ConnectionOut,
    summary="Terminer la connexion avec l'URL de redirection",
)
def complete(request: HttpRequest, payload: RedirectIn) -> ConnectionOut:
    owner = _connecting(request)
    try:
        services.complete_login(owner=owner, redirect_url=payload.redirect_url)
    except services.DisabledError as error:
        raise Http404 from error
    except services.RedirectRefusedError as error:
        # Message fixe : jamais l'URL collée (elle porte un code d'autorisation).
        raise ProblemError(
            422, "Adresse refusée : recommencez la connexion.", type_=REFUSED_TYPE
        ) from error
    except services.LoginRefusedError as error:
        raise ProblemError(
            422, "Basic-Fit a refusé la connexion : recommencez.", type_=LOGIN_REFUSED_TYPE
        ) from error
    except services.UnavailableError as error:
        raise ProblemError(
            503, "Basic-Fit ne répond pas. Réessayez plus tard.", type_=UNAVAILABLE_TYPE
        ) from error
    return _view(owner)


@router.delete("/basicfit/connection/", response={204: None}, summary="Délier Basic-Fit")
def disconnect(request: HttpRequest) -> Status[None]:
    services.disconnect(owner=request_user(request))
    return Status(204, None)


@router.post(
    "/basicfit/sync/",
    response={202: SyncOut},
    summary="Synchroniser maintenant (au plus une fois par heure)",
)
def sync_now(request: HttpRequest) -> Status[SyncOut]:
    owner = request_user(request)
    if ratelimit.consume_or_429(request, action="basicfit_sync", user=owner) is not None:
        raise ProblemError(429, "Trop de demandes. Réessayez plus tard.", type_=RATE_LIMITED_TYPE)
    try:
        services.request_sync(owner=owner)
    except services.DisabledError as error:
        raise Http404 from error
    except services.NotConnectedError as error:
        raise ProblemError(
            409, "Reliez d'abord votre compte Basic-Fit.", type_=NOT_CONNECTED_TYPE
        ) from error
    except services.TooSoonError as error:
        raise ProblemError(
            429, "Synchronisation déjà demandée il y a moins d'une heure.", type_=TOO_SOON_TYPE
        ) from error
    tasks.sync_account.delay(str(owner.pk))
    return Status(202, SyncOut(queued=True))


@router.get("/basicfit/visits/", response=list[VisitOut], summary="Visites d'une période")
def visits(request: HttpRequest, period: Query[Period]) -> list[VisitOut]:
    owner = request_user(request)
    if ratelimit.consume_or_429(request, action="basicfit_read", user=owner, limit_get=True):
        raise ProblemError(
            429, "Trop de demandes. Réessayez dans un instant.", type_=RATE_LIMITED_TYPE
        )
    start, end = period.bounds()
    return [
        VisitOut(date=visit.date, club=visit.club or "")
        for visit in selectors.list_visits(owner=owner, start=start, end=end)
    ]
