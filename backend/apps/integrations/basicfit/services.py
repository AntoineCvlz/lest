"""Écritures de l'intégration Basic-Fit (ADR 0014) : connexion en deux temps (lien, puis URL de
redirection collée), déconnexion. Désactivée par `BASICFIT_ENABLED`."""

import hmac
import re
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.integrations.basicfit.gateway import BasicFitGateway, GatewayAuthError, GatewayError
from apps.integrations.basicfit.models import Connection, PendingLogin, Visit

LOGIN_TTL = timedelta(minutes=10)
# Au plus une synchronisation par heure et par compte (CLAUDE.md), relecture d'une semaine de
# recouvrement, une année à la première (limite d'une requête Basic-Fit : 365 jours).
SYNC_INTERVAL = timedelta(hours=1)
OVERLAP = timedelta(days=7)
FIRST_WINDOW = timedelta(days=364)
SYNC_LOCK_SECONDS = 300
REDIRECT_SCHEME = "com.basicfit.trainingapp"
REDIRECT_PATH = "/oauthredirect"
MAX_REDIRECT_LENGTH = 4096
# Code et `state` : jetons url-safe, longueur bornée (rien d'autre n'est transmis).
_TOKEN = re.compile(r"[A-Za-z0-9._~-]{8,512}")


class DisabledError(Exception):
    """Intégration désactivée (`BASICFIT_ENABLED`) : répondue comme une route absente."""


class RedirectRefusedError(Exception):
    """URL collée invalide, expirée, d'une autre connexion, ou sans connexion commencée."""


class LoginRefusedError(Exception):
    """Basic-Fit refuse le code (expiré, déjà utilisé) : recommencer la connexion."""


class UnavailableError(Exception):
    """Basic-Fit ou le réseau ne répond pas : réessayer plus tard."""


def _enabled() -> None:
    if not settings.BASICFIT_ENABLED:
        raise DisabledError


def start_login(*, owner: User, gateway: BasicFitGateway | None = None) -> str:
    """Commence la connexion de `owner` : garde le `state` et le vérificateur PKCE (chiffrés,
    10 minutes) et renvoie l'URL de connexion Basic-Fit à ouvrir. Une nouvelle demande remplace
    la précédente."""
    _enabled()
    start = (gateway or BasicFitGateway()).start_login()
    PendingLogin.objects.update_or_create(
        owner=owner,
        defaults={"state": start.state, "verifier": start.verifier, "created_at": timezone.now()},
    )
    return start.authorize_url


def _code_from(redirect_url: str, expected_state: str) -> str:
    """Code d'autorisation d'une URL de redirection **complète** dont le `state` est le nôtre."""
    if len(redirect_url) > MAX_REDIRECT_LENGTH:
        raise RedirectRefusedError
    parts = urlsplit(redirect_url.strip())
    if parts.scheme != REDIRECT_SCHEME or parts.path != REDIRECT_PATH:
        raise RedirectRefusedError
    query = parse_qs(parts.query, max_num_fields=10)
    codes, states = query.get("code", []), query.get("state", [])
    if len(codes) != 1 or len(states) != 1:
        raise RedirectRefusedError
    code, state = codes[0], states[0]
    if not (_TOKEN.fullmatch(code) and _TOKEN.fullmatch(state)):
        raise RedirectRefusedError
    if not hmac.compare_digest(state.encode(), expected_state.encode()):
        raise RedirectRefusedError
    return code


def complete_login(
    *, owner: User, redirect_url: str, gateway: BasicFitGateway | None = None
) -> Connection:
    """Termine la connexion de `owner` avec l'URL de redirection collée : `state` vérifié,
    connexion commencée consommée (usage unique, même en cas d'échec), jetons chiffrés.

    Lève `RedirectRefusedError`, `LoginRefusedError` ou `UnavailableError`."""
    _enabled()
    with transaction.atomic():
        pending = PendingLogin.objects.select_for_update().filter(owner=owner).first()
        if pending is None:
            raise RedirectRefusedError
        state, verifier, created = pending.state or "", pending.verifier or "", pending.created_at
        pending.delete()
    if timezone.now() - created > LOGIN_TTL:
        raise RedirectRefusedError
    code = _code_from(redirect_url, state)
    try:
        tokens = (gateway or BasicFitGateway()).exchange_code(code=code, verifier=verifier)
    except GatewayAuthError:
        raise LoginRefusedError from None
    except GatewayError:
        raise UnavailableError from None
    connection, _ = Connection.objects.update_or_create(
        owner=owner,
        defaults={
            "tokens": tokens,
            "status": Connection.Status.CONNECTED,
            "last_error": "",
        },
    )
    return connection


def disconnect(*, owner: User) -> None:
    """Délie le compte Basic-Fit de `owner` : jetons et connexion en cours effacés (idempotent).
    Les données déjà importées restent, comme celles saisies à la main."""
    Connection.objects.filter(owner=owner).delete()
    PendingLogin.objects.filter(owner=owner).delete()


class NotConnectedError(Exception):
    """Aucun compte Basic-Fit relié (ou reconnexion nécessaire)."""


class TooSoonError(Exception):
    """Dernière synchronisation il y a moins d'une heure."""

    def __init__(self, retry_after: timedelta) -> None:
        super().__init__()
        self.retry_after = retry_after


class SyncBusyError(Exception):
    """Une synchronisation de ce compte est déjà en cours."""


@dataclass(frozen=True)
class SyncResult:
    visits: int


def sync(*, owner: User, gateway: BasicFitGateway | None = None) -> SyncResult:
    """Synchronise le club principal et les visites de `owner` (au plus une fois par heure).

    Le jeu de jetons tourné par Basic-Fit est enregistré même en cas d'échec. Refus des jetons :
    connexion marquée à refaire et jetons effacés. Lève `DisabledError`, `NotConnectedError`,
    `TooSoonError`, `SyncBusyError`, `UnavailableError` (à réessayer)."""
    _enabled()
    lock = f"basicfit:sync:{owner.pk}"
    if not cache.add(lock, 1, timeout=SYNC_LOCK_SECONDS):
        raise SyncBusyError
    try:
        return _sync(owner, gateway or BasicFitGateway())
    finally:
        cache.delete(lock)


def _sync(owner: User, gateway: BasicFitGateway) -> SyncResult:
    connection = Connection.objects.filter(owner=owner, status=Connection.Status.CONNECTED).first()
    if connection is None or not connection.tokens:
        raise NotConnectedError
    now = timezone.now()
    if connection.last_sync_at and now - connection.last_sync_at < SYNC_INTERVAL:
        raise TooSoonError(SYNC_INTERVAL - (now - connection.last_sync_at))
    today = timezone.localdate()
    start = (
        timezone.localdate(connection.last_sync_at) - OVERLAP
        if connection.last_sync_at
        else today - FIRST_WINDOW
    )
    try:
        data = gateway.fetch(tokens=connection.tokens, start=start, end=today)
    except GatewayAuthError:
        Connection.objects.filter(pk=connection.pk).update(
            status=Connection.Status.EXPIRED, tokens="", last_error="auth"
        )
        raise NotConnectedError from None
    except GatewayError as error:
        if error.tokens:
            connection.tokens = error.tokens
        connection.last_error = "unavailable"
        connection.save(update_fields=["tokens", "last_error"])
        raise UnavailableError from None
    with transaction.atomic():
        connection.tokens = data.tokens
        connection.home_club = data.home_club
        connection.last_sync_at = now
        connection.last_error = ""
        connection.save(update_fields=["tokens", "home_club", "last_sync_at", "last_error"])
        days = {visit.day: visit.club for visit in data.visits if start <= visit.day <= today}
        for day, club in days.items():
            Visit.objects.update_or_create(owner=owner, date=day, defaults={"club": club})
    return SyncResult(visits=len(days))


def due_for_sync() -> list[str]:
    """Comptes reliés dont la dernière synchronisation date de plus d'une heure."""
    cutoff = timezone.now() - SYNC_INTERVAL
    return [
        str(owner_id)
        for owner_id in Connection.objects.filter(status=Connection.Status.CONNECTED)
        .exclude(last_sync_at__gte=cutoff)
        .values_list("owner_id", flat=True)
    ]
