import uuid
from decimal import Decimal
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


# Bornes de plausibilité de la taille, partagées avec le schéma de l'API.
MIN_HEIGHT_M = Decimal("1.00")
MAX_HEIGHT_M = Decimal("2.50")


class Goal(models.TextChoices):
    GAIN = "gain", "Prise de masse"
    MAINTAIN = "maintain", "Maintien"
    CUT = "cut", "Sèche"


class UnitSystem(models.TextChoices):
    """Unités d'affichage uniquement : tout est stocké en unités SI."""

    METRIC = "metric", "Métrique (kg, cm)"
    IMPERIAL = "imperial", "Impérial (lb, ft, in)"


class OneRepMaxFormula(models.TextChoices):
    """Estimation du 1RM (charge maximale sur une répétition), au choix dans le profil."""

    EPLEY = "epley", "Epley"
    BRZYCKI = "brzycki", "Brzycki"


class Profile(models.Model):
    """
    Profil d'entraînement, créé à la fin de l'onboarding (un compte sans profil ne l'a pas fini).

    Données minimales : sexe, âge et niveau d'activité ne seront demandés qu'avec les objectifs
    caloriques (Phase 3), qui en ont besoin.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, primary_key=True, related_name="profile"
    )
    height_m = models.DecimalField("taille (m)", max_digits=3, decimal_places=2)
    goal = models.CharField("objectif", max_length=16, choices=Goal.choices)
    unit_system = models.CharField(
        "unités d'affichage", max_length=16, choices=UnitSystem.choices, default=UnitSystem.METRIC
    )
    one_rm_formula = models.CharField(
        "formule du 1RM estimé",
        max_length=16,
        choices=OneRepMaxFormula.choices,
        default=OneRepMaxFormula.EPLEY,
    )
    onboarded_at = models.DateTimeField("fin de l'onboarding", default=timezone.now)
    updated_at = models.DateTimeField("mise à jour", auto_now=True)

    class Meta:
        verbose_name = "profil"
        verbose_name_plural = "profils"
        constraints: ClassVar[list[models.BaseConstraint]] = [
            models.CheckConstraint(
                condition=models.Q(height_m__gte=MIN_HEIGHT_M, height_m__lte=MAX_HEIGHT_M),
                name="accounts_profile_height_plausible",
            ),
            models.CheckConstraint(
                condition=models.Q(goal__in=Goal.values), name="accounts_profile_goal_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(unit_system__in=UnitSystem.values),
                name="accounts_profile_unit_system_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(one_rm_formula__in=OneRepMaxFormula.values),
                name="accounts_profile_one_rm_formula_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"Profil de {self.user}"
