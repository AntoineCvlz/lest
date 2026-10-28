from datetime import datetime
from typing import Literal
from uuid import UUID

from allauth.account.adapter import get_adapter as get_account_adapter
from allauth.core import ratelimit
from django.http import Http404, HttpRequest, HttpResponse
from django.utils import timezone
from ninja import Field, Router, Schema, Status
from ninja.errors import HttpError

from apps.accounts.models import MAX_HEIGHT_M, MIN_HEIGHT_M, Profile
from apps.accounts.selectors import export_account, get_profile
from apps.accounts.services import IncorrectPasswordError, delete_account, save_profile
from common.auth import request_user
from common.problems import ProblemError

router = Router(tags=["accounts"])

# Type RFC 9457 du mauvais mot de passe : distinct des autres 403 (CSRF, origine refusée).
WRONG_CREDENTIALS_TYPE = "urn:lest:problem:incorrect-password"

GoalValue = Literal["gain", "maintain", "cut"]
UnitSystemValue = Literal["metric", "imperial"]


class MeOut(Schema):
    id: UUID
    email: str


class ProfileIn(Schema):
    # Strict : ni booléen (`true` vaudrait 1,0 m) ni chaîne.
    height_m: float = Field(strict=True, ge=float(MIN_HEIGHT_M), le=float(MAX_HEIGHT_M))
    goal: GoalValue
    unit_system: UnitSystemValue


class ProfileOut(Schema):
    height_m: float
    goal: GoalValue
    unit_system: UnitSystemValue
    onboarded_at: datetime


def _profile_out(profile: Profile) -> ProfileOut:
    return ProfileOut(
        height_m=float(profile.height_m),
        goal=profile.goal,  # type: ignore[arg-type]  # garanti par la contrainte en base
        unit_system=profile.unit_system,  # type: ignore[arg-type]
        onboarded_at=profile.onboarded_at,
    )


@router.get("/me/", response=MeOut, summary="Compte connecté")
def me(request: HttpRequest) -> MeOut:
    user = request_user(request)
    return MeOut(id=user.pk, email=user.email)


@router.get("/me/profile/", response=ProfileOut, summary="Profil du compte connecté")
def read_profile(request: HttpRequest) -> ProfileOut:
    profile = get_profile(request_user(request))
    if profile is None:  # onboarding pas encore terminé
        raise Http404
    return _profile_out(profile)


@router.put("/me/profile/", response=ProfileOut, summary="Créer ou modifier son profil")
def write_profile(request: HttpRequest, payload: ProfileIn) -> ProfileOut:
    profile = save_profile(
        user=request_user(request),
        height_m=payload.height_m,
        goal=payload.goal,
        unit_system=payload.unit_system,
    )
    return _profile_out(profile)


class AccountDeletionIn(Schema):
    password: str


@router.delete(
    "/me/", response={204: None}, summary="Supprimer définitivement son compte et ses données"
)
def delete_me(request: HttpRequest, payload: AccountDeletionIn) -> Status[None]:
    user = request_user(request)
    # Réauthentification (10/min et 30/jour par compte) et compteur d'échecs partagé avec la
    # connexion : `DELETE /me/` ne doit pas permettre de tester des mots de passe hors du
    # verrouillage du login. Clé d'allauth (méthode interne, version épinglée).
    failures_key = get_account_adapter(request)._get_login_attempts_cache_key(
        request, email=user.email
    )
    if not ratelimit.consume(request, action="reauthenticate", user=user) or not (
        ratelimit.consume(request, action="login_failed", key=failures_key, dry_run=True)
    ):
        raise HttpError(429, "Trop de tentatives. Réessayez plus tard.")
    try:
        delete_account(user=user, password=payload.password)
    except IncorrectPasswordError as error:
        ratelimit.consume(request, action="login_failed", key=failures_key)
        raise ProblemError(403, "Mot de passe incorrect.", type_=WRONG_CREDENTIALS_TYPE) from error
    return Status(204, None)


@router.get("/me/export/", summary="Télécharger toutes ses données (JSON)")
def export_me(request: HttpRequest, response: HttpResponse) -> dict[str, object]:
    filename = f"lest-export-{timezone.localdate():%Y-%m-%d}.json"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return export_account(request_user(request))
