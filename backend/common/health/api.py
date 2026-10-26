from typing import Literal

from django.http import HttpRequest
from ninja import Router, Schema, Status

from .selectors import get_health_report

router = Router(tags=["health"])

ComponentState = Literal["ok", "down"]


class HealthChecks(Schema):
    database: ComponentState
    cache: ComponentState


class HealthOut(Schema):
    status: Literal["ok", "degraded"]
    checks: HealthChecks


def _state(ok: bool) -> ComponentState:
    return "ok" if ok else "down"


@router.get(
    "/health/",
    response={200: HealthOut, 503: HealthOut},
    summary="État de l'API et de ses dépendances",
    auth=None,
)
def health(request: HttpRequest) -> Status[HealthOut]:
    report = get_health_report()
    body = HealthOut(
        status="ok" if report.healthy else "degraded",
        checks=HealthChecks(database=_state(report.database), cache=_state(report.cache)),
    )
    return Status(200 if report.healthy else 503, body)
