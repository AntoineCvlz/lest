from typing import Any

from allauth.account.models import EmailAddress
from django.utils import timezone

from .models import Profile, User


def get_profile(user: User) -> Profile | None:
    """Profil de `user`, ou `None` s'il n'a pas fini l'onboarding."""
    return Profile.objects.filter(user=user).first()


def export_account(user: User) -> dict[str, Any]:
    """
    Données du compte, lisibles par la personne (droit d'accès et de portabilité, RGPD).

    Sans empreinte de mot de passe, sessions, jetons ni identifiants internes. Chaque table
    listée dans `gdpr.EXPORTED_MODELS` doit y figurer.
    """
    profile = get_profile(user)
    return {
        "exported_at": timezone.now().isoformat(),
        "account": {
            "email": user.email,
            "date_joined": user.date_joined.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
        },
        "email_addresses": [
            {"email": address.email, "verified": address.verified, "primary": address.primary}
            for address in EmailAddress.objects.filter(user=user).order_by("email")
        ],
        "profile": (
            {
                "height_m": float(profile.height_m),
                "goal": profile.goal,
                "unit_system": profile.unit_system,
                "onboarded_at": profile.onboarded_at.isoformat(),
            }
            if profile
            else None
        ),
    }
