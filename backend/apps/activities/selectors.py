"""Lectures du domaine `activities` : toujours filtrées par propriétaire, sur une période bornée
(valeurs chiffrées : tri et calculs en Python, ADR 0012)."""

from datetime import date
from typing import Any

from apps.accounts.models import User
from apps.activities.models import Activity


def list_activities(*, owner: User, start: date, end: date) -> list[Activity]:
    """Activités de `owner` du `start` au `end` inclus, par date puis ordre de saisie."""
    return list(Activity.objects.filter(owner=owner, date__range=(start, end)))


def _number(value: object) -> float | None:
    return None if value is None else float(str(value))


def export_activities(*, owner: User) -> list[dict[str, Any]]:
    """Activités de `owner`, déchiffrées, pour l'export RGPD."""
    return [
        {
            "id": str(activity.id),
            "date": activity.date.isoformat(),
            "sport": activity.sport,
            "duration_s": int(activity.duration_s or 0),
            "distance_m": _number(activity.distance_m),
            "avg_heart_rate": _number(activity.avg_heart_rate),
            "feeling": _number(activity.feeling),
            "metrics": activity.metric_values(),
        }
        for activity in Activity.objects.filter(owner=owner)
    ]
