import uuid
from typing import Any, ClassVar

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


def normalize_email(email: str) -> str:
    """E-mail en minuscules et sans espaces : une seule identité par adresse."""
    return email.strip().lower()


class UserManager(BaseUserManager["User"]):
    def create_user(self, email: str, password: str | None = None, **extra: Any) -> "User":
        """Crée un utilisateur ; sans mot de passe, le compte ne peut pas s'en servir."""
        email = normalize_email(email)
        if not email:
            raise ValueError("L'adresse e-mail est obligatoire.")
        user = self.model(email=email, **extra)
        user.set_password(password)  # None → mot de passe inutilisable
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str | None = None, **extra: Any) -> "User":
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if extra["is_staff"] is not True or extra["is_superuser"] is not True:
            raise ValueError("Un superutilisateur doit avoir is_staff et is_superuser.")
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """
    Compte Lest, identifié par son e-mail. Données minimales : ni nom ni prénom.

    Clé primaire UUID : les identifiants exposés par l'API ne sont pas énumérables.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # unique=True exigé par Django pour USERNAME_FIELD (auth.E003) ; la contrainte Lower(email)
    # ci-dessous ajoute l'insensibilité à la casse, que unique=True seul ne garantit pas.
    email = models.EmailField("adresse e-mail", max_length=254, unique=True)
    is_active = models.BooleanField("actif", default=True)
    is_staff = models.BooleanField("accès à l'administration", default=False)
    date_joined = models.DateTimeField("inscription", default=timezone.now)

    objects: ClassVar[UserManager] = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    class Meta:
        verbose_name = "utilisateur"
        verbose_name_plural = "utilisateurs"
        constraints: ClassVar[list[models.BaseConstraint]] = [
            # Unicité insensible à la casse, garantie par la base et pas seulement par le code.
            models.UniqueConstraint(Lower("email"), name="accounts_user_email_ci_unique"),
        ]

    def __str__(self) -> str:
        return self.email
