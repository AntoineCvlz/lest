"""Serveur WebAuthn à origine exacte, à la place de celui d'allauth (`AccountsConfig.ready()`).

allauth laisse fido2 vérifier l'origine par rapport au RP ID : tout sous-domaine du domaine
public et tout port de `localhost` passent. Une page compromise sur un site frère (sous-domaine
abandonné, Storybook publié…) obtiendrait alors une assertion valide. Ici, seule l'origine
publique de Lest (`FRONTEND_URL` : schéma, hôte et port) est acceptée.
"""

from urllib.parse import urlsplit

from allauth.mfa.adapter import get_adapter
from django.conf import settings
from fido2.server import Fido2Server
from fido2.webauthn import PublicKeyCredentialRpEntity


def public_origin() -> str:
    url = urlsplit(settings.FRONTEND_URL)
    return f"{url.scheme}://{url.netloc}"


def get_server() -> Fido2Server:
    rp = PublicKeyCredentialRpEntity(**get_adapter().get_public_key_credential_rp_entity())
    origin = public_origin()
    return Fido2Server(rp, verify_origin=lambda candidate: candidate == origin)
