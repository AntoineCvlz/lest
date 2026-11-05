"""Lectures de l'intégration Basic-Fit : état de la connexion, sans jamais les jetons."""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from django.conf import settings

from apps.accounts.models import User
from apps.integrations.basicfit.models import Connection, Visit


@dataclass(frozen=True)
class ConnectionView:
    enabled: bool
    status: str
    connected_at: datetime | None
    last_sync_at: datetime | None
    last_error: str
    home_club: str = ""


def connection_view(*, owner: User) -> ConnectionView:
    """État de la liaison Basic-Fit de `owner` : désactivée, absente, reliée ou à refaire."""
    if not settings.BASICFIT_ENABLED:
        return ConnectionView(False, "disabled", None, None, "")
    connection = (
        Connection.objects.filter(owner=owner)
        .only("status", "connected_at", "last_sync_at", "last_error")
        .first()
    )
    if connection is None:
        return ConnectionView(True, "none", None, None, "")
    return ConnectionView(
        True,
        connection.status,
        connection.connected_at,
        connection.last_sync_at,
        connection.last_error,
        connection.home_club or "",
    )


def export_connection(*, owner: User) -> dict[str, Any] | None:
    """Liaison Basic-Fit de `owner` pour l'export RGPD : état et dates, **jamais les jetons**."""
    connection = Connection.objects.filter(owner=owner).first()
    if connection is None:
        return None
    return {
        "status": connection.status,
        "connected_at": connection.connected_at.isoformat(),
        "last_sync_at": connection.last_sync_at.isoformat() if connection.last_sync_at else None,
        "home_club": connection.home_club or "",
        "visits": [
            {"date": visit.date.isoformat(), "club": visit.club or ""}
            for visit in Visit.objects.filter(owner=owner)
        ],
    }


def list_visits(*, owner: User, start: date, end: date) -> list[Visit]:
    """Visites en club de `owner` du `start` au `end` inclus, par date."""
    return list(Visit.objects.filter(owner=owner, date__range=(start, end)))
