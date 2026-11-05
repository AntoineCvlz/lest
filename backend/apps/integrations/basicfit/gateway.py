"""Passerelle Basic-Fit (ADR 0014) : **seul** module qui importe le paquet `basicfit`.

Le reste de Lest ne voit que des DTO internes et des erreurs à nous. Les appels réseau passent
par une boucle asyncio courte (le paquet est asynchrone, Django et Celery ne le sont pas). Les
messages des exceptions du paquet ne sortent jamais d'ici : ils peuvent reprendre la réponse de
Basic-Fit.
"""

import asyncio
import json
from dataclasses import dataclass
from datetime import date

import aiohttp
from basicfit import pkce
from basicfit.auth import AuthManager
from basicfit.client import BasicFitClient
from basicfit.exceptions import BasicFitAuthError, BasicFitError
from basicfit.models import TokenSet


class _GatewayFailureError(Exception):
    """Erreur de la passerelle ; `tokens` : jeu de jetons tourné pendant l'appel, à enregistrer
    malgré l'échec (l'ancien n'est plus valable chez Basic-Fit)."""

    def __init__(self, tokens: str | None = None) -> None:
        super().__init__()
        self.tokens = tokens


class GatewayAuthError(_GatewayFailureError):
    """Basic-Fit refuse la connexion ou les jetons : reconnexion nécessaire."""


class GatewayError(_GatewayFailureError):
    """Panne de Basic-Fit ou du réseau : à réessayer plus tard."""


# Texte venu de Basic-Fit (nom du club) : borné, sans caractère de contrôle.
MAX_CLUB_LENGTH = 120


def _clean(value: object) -> str:
    text = value if isinstance(value, str) else ""
    return "".join(c for c in text if c.isprintable())[:MAX_CLUB_LENGTH].strip()


@dataclass(frozen=True)
class Visit:
    day: date
    club: str


@dataclass(frozen=True)
class MemberData:
    """Ce que Lest garde du membre (ADR 0014) ; tout le reste du profil est ignoré ici."""

    tokens: str
    home_club: str
    visits: list[Visit]


def _visits(raw: list[object]) -> list[Visit]:
    visits = []
    for item in raw:
        text = str(getattr(item, "date", "") or "")[:10]
        try:
            day = date.fromisoformat(text)
        except ValueError:
            continue
        visits.append(Visit(day=day, club=_clean(getattr(item, "club", ""))))
    return visits


@dataclass(frozen=True)
class LoginStart:
    authorize_url: str
    state: str
    verifier: str


def _dump(tokens: TokenSet) -> str:
    return json.dumps(tokens.to_dict(), sort_keys=True)


class BasicFitGateway:
    """Accès à Basic-Fit ; une instance par opération."""

    def start_login(self) -> LoginStart:
        """Vérificateur PKCE, `state` et URL de connexion à ouvrir dans le navigateur."""
        bundle = pkce.start_login()
        return LoginStart(
            authorize_url=bundle.authorize_url, state=bundle.state, verifier=bundle.verifier
        )

    def exchange_code(self, *, code: str, verifier: str) -> str:
        """Échange le code d'autorisation contre un jeu de jetons, sérialisé (JSON) pour être
        chiffré par l'appelant. Lève `GatewayAuthError` ou `GatewayError`."""

        async def run() -> TokenSet:
            async with aiohttp.ClientSession() as session:
                return await AuthManager.async_exchange_code(session, code, verifier)

        try:
            return _dump(asyncio.run(run()))
        # `from None` : la trace ne montre pas l'erreur du paquet (elle cite Basic-Fit).
        except BasicFitAuthError:
            raise GatewayAuthError from None
        except (BasicFitError, aiohttp.ClientError, TimeoutError):
            raise GatewayError from None
        # Réponse inattendue (JSON qui n'est pas un objet, encodage invalide…) : jamais un 500
        # dont la trace citerait la réponse ou les jetons.
        except Exception:
            raise GatewayError from None

    def fetch(self, *, tokens: str, start: date, end: date) -> MemberData:
        """Club principal et visites du `start` au `end` (365 jours au plus). Le jeu de jetons
        rendu est le dernier tourné ; en cas d'échec, l'erreur le porte aussi (`tokens`)."""
        latest = {"tokens": tokens}

        def rotated(new: TokenSet) -> None:
            latest["tokens"] = _dump(new)

        async def run() -> tuple[str, list[Visit]]:
            current = TokenSet.from_dict(json.loads(tokens))
            async with BasicFitClient.create(current, token_updated=rotated) as client:
                member = await client.get_member()
                visits = await client.get_visits(from_date=start, to_date=end)
            return _clean(member.home_club), _visits(list(visits))

        try:
            home_club, visits = asyncio.run(run())
        except BasicFitAuthError:
            raise GatewayAuthError(latest["tokens"]) from None
        except (BasicFitError, aiohttp.ClientError, TimeoutError):
            raise GatewayError(latest["tokens"]) from None
        except Exception:
            raise GatewayError(latest["tokens"]) from None
        return MemberData(tokens=latest["tokens"], home_club=home_club, visits=visits)
