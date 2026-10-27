from uuid import UUID

from django.http import HttpRequest
from ninja import Router, Schema

from common.auth import request_user

router = Router(tags=["accounts"])


class MeOut(Schema):
    id: UUID
    email: str


@router.get("/me/", response=MeOut, summary="Compte connecté")
def me(request: HttpRequest) -> MeOut:
    user = request_user(request)
    return MeOut(id=user.pk, email=user.email)
