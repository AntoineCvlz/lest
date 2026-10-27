from typing import Any

import factory
from factory.declarations import Sequence
from factory.django import Password

from apps.accounts.models import User

TEST_PASSWORD = "motdepasse-de-test"


class UserFactory(factory.django.DjangoModelFactory[User]):
    """Utilisateur actif dont le mot de passe est `TEST_PASSWORD`."""

    class Meta:
        model = User
        skip_postgeneration_save = True

    email = Sequence(lambda n: f"utilisateur{n}@example.com")
    password = Password(TEST_PASSWORD)


def make_user(**overrides: Any) -> User:
    """Crée un utilisateur en base ; point d'entrée typé des tests (factory-boy l'est peu)."""
    user = UserFactory.create(**overrides)
    assert isinstance(user, User)
    return user
