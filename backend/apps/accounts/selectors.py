from typing import Any

from allauth.account.models import EmailAddress
from allauth.mfa.models import Authenticator
from allauth.usersessions.models import UserSession
from django.contrib.sessions.models import Session
from django.utils import timezone

from apps.activities.selectors import export_activities
from apps.body.selectors import export_measurements, export_photos, export_weights
from apps.nutrition.selectors import (
    export_custom_foods,
    export_journal,
    export_targets,
    export_water,
)
from apps.training.selectors import export_programs, export_records, export_workouts

from .models import OneRepMaxFormula, Profile, User


def get_profile(user: User) -> Profile | None:
    """Profil de `user`, ou `None` s'il n'a pas fini l'onboarding."""
    return Profile.objects.filter(user=user).first()


def get_one_rm_formula(user: User) -> str:
    """Formule du 1RM estimé de `user` (Epley sans profil)."""
    profile = get_profile(user)
    return profile.one_rm_formula if profile else OneRepMaxFormula.EPLEY


def export_account(user: User) -> dict[str, Any]:
    """
    Données du compte, lisibles par la personne (droit d'accès et de portabilité, RGPD).

    Sans empreinte de mot de passe, clés de session, jetons ni identifiants internes. Chaque table
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
        # Méthodes de double authentification : type, nom des passkeys et dates, jamais leurs
        # secrets ni leurs clés publiques.
        "authenticators": [
            {
                "type": authenticator.type,
                "name": (
                    authenticator.wrap().name
                    if authenticator.type == Authenticator.Type.WEBAUTHN
                    else None
                ),
                "created_at": authenticator.created_at.isoformat(),
                "last_used_at": (
                    authenticator.last_used_at.isoformat() if authenticator.last_used_at else None
                ),
            }
            for authenticator in Authenticator.objects.filter(user=user).order_by("created_at")
        ],
        # Appareils connectés (sessions encore valables, comme la liste de l'app) : adresse IP,
        # navigateur et dates, jamais la clé de session.
        "sessions": [
            {
                "ip": session.ip,
                "user_agent": session.user_agent,
                "created_at": session.created_at.isoformat(),
                "last_seen_at": session.last_seen_at.isoformat(),
            }
            for session in UserSession.objects.filter(
                user=user,
                session_key__in=Session.objects.filter(expire_date__gt=timezone.now()).values(
                    "session_key"
                ),
            ).order_by("created_at")
        ],
        # Séances, exercices et séries (domaine `training`, lu par son sélecteur).
        "workouts": export_workouts(owner=user),
        "personal_records": export_records(owner=user),
        "programs": export_programs(owner=user),
        # Pesées et mensurations (domaine `body`), déchiffrées pour l'export.
        "body_weights": export_weights(owner=user),
        "body_measurements": export_measurements(owner=user),
        # Photos : métadonnées ici, images dans une archive dédiée (ADR 0008).
        "progress_photos": export_photos(owner=user),
        "custom_foods": export_custom_foods(owner=user),
        # Journal des repas et eau, déchiffrés pour l'export (ADR 0010).
        "food_journal": export_journal(owner=user),
        "water": export_water(owner=user),
        "nutrition_target": export_targets(owner=user),
        # Activités hors musculation, déchiffrées (ADR 0012).
        "activities": export_activities(owner=user),
        "profile": (
            {
                "height_m": float(profile.height_m),
                "goal": profile.goal,
                "unit_system": profile.unit_system,
                "one_rm_formula": profile.one_rm_formula,
                "onboarded_at": profile.onboarded_at.isoformat(),
            }
            if profile
            else None
        ),
    }
