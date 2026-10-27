from allauth.account.models import EmailAddress
from django.contrib.auth.password_validation import validate_password
from django.db import transaction

from .models import User, normalize_email


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
