"""Passerelle Basic-Fit (ADR 0014) : **seul** module qui importe le paquet `basicfit`.

Le reste de Lest ne voit que des DTO internes et des erreurs à nous. Les appels réseau passent
par une boucle asyncio courte (le paquet est asynchrone, Django et Celery ne le sont pas). Les
messages des exceptions du paquet ne sortent jamais d'ici : ils peuvent reprendre la réponse de
Basic-Fit.
"""

import asyncio
import json
from dataclasses import dataclass

import aiohttp
from basicfit import pkce
from basicfit.auth import AuthManager
from basicfit.exceptions import BasicFitAuthError, BasicFitError
from basicfit.models import TokenSet


class GatewayAuthError(Exception):
    """Basic-Fit refuse la connexion ou les jetons : reconnexion nécessaire."""


class GatewayError(Exception):
    """Panne de Basic-Fit ou du réseau : à réessayer plus tard."""


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
