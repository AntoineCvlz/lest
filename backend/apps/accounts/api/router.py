from datetime import datetime
from typing import Literal
from uuid import UUID

from django.http import Http404, HttpRequest
from ninja import Field, Router, Schema

from apps.accounts.models import MAX_HEIGHT_M, MIN_HEIGHT_M, Profile
from apps.accounts.selectors import get_profile
from apps.accounts.services import save_profile
from common.auth import request_user

router = Router(tags=["accounts"])

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
