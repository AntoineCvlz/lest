import logging
from decimal import ROUND_HALF_UP, Decimal

from allauth.account.models import EmailAddress
from allauth.usersessions.internal.flows.sessions import end_other_sessions
from django.conf import settings
from django.contrib.admin.models import LogEntry
from django.contrib.auth.password_validation import validate_password
from django.contrib.contenttypes.models import ContentType
from django.core.mail import send_mail
from django.db import transaction
from django.http import HttpRequest
from django.template.loader import render_to_string

from . import events
from .models import OneRepMaxFormula, Profile, User, normalize_email

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


def lock_account(user: User) -> None:
    """Verrouille le compte jusqu'à la fin de la transaction : sérialise les recalculs propres
    au compte (records de `training`) et le changement de formule du profil."""
    User.objects.select_for_update().filter(pk=user.pk).first()


def save_profile(
    *,
    user: User,
    height_m: float,
    goal: str,
    unit_system: str,
    one_rm_formula: str | None = None,
) -> Profile:
    """
    Crée le profil de `user` (fin de l'onboarding) ou le met à jour.

    La taille est stockée en mètres, arrondie au centimètre. `one_rm_formula` absente : formule
    actuelle gardée (Epley à la création). Un changement de formule émet
    `events.one_rm_formula_changed` (records recalculés par `training`), dans la même
    transaction. Lève `ValidationError` pour une valeur hors des bornes, sans rien enregistrer.
    """
    with transaction.atomic():
        # Même ordre de verrous que les écritures de séries (compte, puis profil) : pas
        # d'interblocage, et aucune série ne se recalcule avec la formule qui s'en va.
        lock_account(user)
        current = Profile.objects.select_for_update().filter(user=user).first()
        previous_formula = current.one_rm_formula if current else OneRepMaxFormula.EPLEY
        values = {
            "height_m": Decimal(str(height_m)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            "goal": goal,
            "unit_system": unit_system,
            "one_rm_formula": one_rm_formula or previous_formula,
        }
        # Valeurs validées sans l'unicité, puis écriture atomique : deux premiers envois
        # simultanés (double tap, rejeu hors ligne) donnent un seul profil, sans erreur.
        Profile(user=user, **values).full_clean(validate_unique=False)
        profile, _ = Profile.objects.update_or_create(user=user, defaults=values)
        if profile.one_rm_formula != previous_formula:
            events.one_rm_formula_changed.send(sender=Profile, user=user)
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


def sign_out_other_devices(request: HttpRequest) -> None:
    """Ferme toutes les sessions du compte sauf celle de `request` : leurs jetons (accès et
    refresh, validés avec état) cessent aussitôt de fonctionner.

    Appelé quand un second facteur est ajouté : une session ouverte avant, peut-être par
    quelqu'un qui connaissait le mot de passe, ne doit pas survivre à la protection nouvelle.
    """
    end_other_sessions(request, request.user)
