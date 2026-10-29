from ipaddress import ip_address
from typing import Any
from urllib.parse import urlsplit

from django.conf import settings
from django.core.checks import Error, register


@register("security", deploy=True)
def check_mfa_bypass(app_configs: Any, **kwargs: Any) -> list[Error]:
    """Refuse un code TOTP de contournement (`MFA_TOTP_INSECURE_BYPASS_CODE`) hors DEBUG.

    allauth accepte ce code pour tout compte : en prod, il annulerait la double authentification.
    """
    if getattr(settings, "MFA_TOTP_INSECURE_BYPASS_CODE", None) and not settings.DEBUG:
        return [
            Error(
                "MFA_TOTP_INSECURE_BYPASS_CODE est défini hors DEBUG.",
                hint="Retirer ce réglage : il désactive la double authentification.",
                id="accounts.E001",
            )
        ]
    return []


@register("security", deploy=True)
def check_webauthn_origin(app_configs: Any, **kwargs: Any) -> list[Error]:
    """Refuse `MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN` : il désactive la vérification de l'origine
    des passkeys, donc la protection contre l'hameçonnage qui fait leur intérêt."""
    if getattr(settings, "MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN", False):
        return [
            Error(
                "MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN est activé.",
                hint="Retirer ce réglage : toute origine serait acceptée pour les passkeys.",
                id="accounts.E002",
            )
        ]
    return []


@register("security", deploy=True)
def check_frontend_url(app_configs: Any, **kwargs: Any) -> list[Error]:
    """`FRONTEND_URL` fixe le domaine des passkeys : en prod, une origine HTTPS sur un nom de
    domaine, sans chemin. Le changer après coup rend toutes les passkeys inutilisables."""
    url = urlsplit(settings.FRONTEND_URL)
    host = url.hostname or ""
    try:
        ip_address(host)
        is_ip = True
    except ValueError:
        is_ip = False
    if (
        url.scheme != "https"
        or not host
        or is_ip
        or host == "localhost"
        or url.path not in ("", "/")
    ):
        return [
            Error(
                "FRONTEND_URL n'est pas une origine HTTPS publique.",
                hint="Ex. https://lest.fr : schéma https, nom de domaine, aucun chemin.",
                id="accounts.E003",
            )
        ]
    return []
