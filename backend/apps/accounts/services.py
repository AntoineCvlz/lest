import logging
from decimal import ROUND_HALF_UP, Decimal

from allauth.account.models import EmailAddress
from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.contrib.auth.password_validation import validate_password
from django.contrib.contenttypes.models import ContentType
from django.core.mail import send_mail
from django.db import transaction
from django.template.loader import render_to_string

from .models import Profile, User, normalize_email

logger = logging.getLogger(__name__)


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


class IncorrectPasswordError(Exception):
    """Le mot de passe saisi pour confirmer une action sensible est faux."""


def delete_account(*, user: User, password: str) -> None:
    """
    Supprime définitivement le compte et toutes ses données (droit à l'effacement, RGPD).

    Exige le mot de passe actuel (`IncorrectPasswordError` sinon, sans rien supprimer). Les
    tables liées suivent par `CASCADE` (vérifié par `test_gdpr.py`). Les jetons d'accès et de
    refresh de tous les appareils tombent avec l'utilisateur : la validation avec état d'allauth
    ne retrouve plus le compte de leur session (les sessions orphelines expirent seules).
    Le journal d'administration, qui cite le compte sans clé étrangère, est purgé aussi.
    Un e-mail confirme la suppression, une fois celle-ci validée en base.
    """
    if not user.check_password(password):
        raise IncorrectPasswordError
    email = user.email
    with transaction.atomic():
        for model, object_id in ((User, user.pk), (Profile, user.pk)):
            LogEntry.objects.filter(
                content_type=ContentType.objects.get_for_model(model), object_id=str(object_id)
            ).delete()
        user.delete()
    transaction.on_commit(lambda: send_account_mail("account/email/account_deleted", email))


def send_account_mail(template_prefix: str, email: str) -> None:
    """E-mail de compte (`<prefix>_subject.txt`, `<prefix>_message.txt`), au mieux.

    Un échec d'envoi n'interrompt jamais l'opération qui le déclenche. Hors requête (services,
    signaux, futures tâches) : pas l'envoi d'allauth, qui déduit le site de la requête ; même
    préfixe de sujet que les e-mails d'allauth.
    """
    subject = render_to_string(f"{template_prefix}_subject.txt").strip()
    try:
        send_mail(
            f"{settings.ACCOUNT_EMAIL_SUBJECT_PREFIX}{subject}",
            render_to_string(f"{template_prefix}_message.txt"),
            settings.DEFAULT_FROM_EMAIL,
            [email],
        )
    except Exception:
        # Sans l'exception ni sa trace : elles contiennent l'adresse du destinataire.
        # Toute erreur (SMTP, réseau, configuration) est attendue ici : l'envoi est au mieux.
        logger.warning("Account email could not be sent (%s)", template_prefix)
