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
