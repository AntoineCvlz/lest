"""Lectures de l'intégration Basic-Fit : état de la connexion, sans jamais les jetons."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from django.conf import settings

from apps.accounts.models import User
from apps.integrations.basicfit.models import Connection


@dataclass(frozen=True)
class ConnectionView:
    enabled: bool
    status: str
    connected_at: datetime | None
    last_sync_at: datetime | None
    last_error: str


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
    }
