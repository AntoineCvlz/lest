from decimal import ROUND_HALF_UP, Decimal

from allauth.account.models import EmailAddress
from django.contrib.auth.password_validation import validate_password
from django.db import transaction

from .models import Profile, User, normalize_email


def create_verified_user(*, email: str, password: str) -> User:
    """
    Crée un compte actif dont l'e-mail est déjà vérifié, sans passer par le parcours d'inscription.

    Réservé aux outils (compte des E2E, démo) ; le mot de passe respecte les mêmes règles qu'à
    l'inscription. Lève `ValidationError` sinon, sans rien créer.
    """
    email = normalize_email(email)
    validate_password(password, User(email=email))
    with transaction.atomic():
        user = User.objects.create_user(email, password)
        EmailAddress.objects.create(user=user, email=email, primary=True, verified=True)
    return user


def save_profile(*, user: User, height_m: float, goal: str, unit_system: str) -> Profile:
    """
    Crée le profil de `user` (fin de l'onboarding) ou le met à jour.

    La taille est stockée en mètres, arrondie au centimètre. Lève `ValidationError` pour une
    valeur hors des bornes du modèle, sans rien enregistrer.
    """
    values = {
        "height_m": Decimal(str(height_m)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        "goal": goal,
        "unit_system": unit_system,
    }
    # Valeurs validées sans l'unicité, puis écriture atomique : deux premiers envois simultanés
    # (double tap, rejeu hors ligne) donnent un seul profil, sans erreur.
    Profile(user=user, **values).full_clean(validate_unique=False)
    profile, _ = Profile.objects.update_or_create(user=user, defaults=values)
    return profile
