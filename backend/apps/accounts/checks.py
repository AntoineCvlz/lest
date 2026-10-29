from typing import Any

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
