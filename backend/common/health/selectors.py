"""Lectures de l'état des dépendances techniques (base de données, cache)."""

import logging
import secrets
from dataclasses import dataclass

from django.core.cache import cache
from django.db import DatabaseError, connection

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class HealthReport:
    database: bool
    cache: bool

    @property
    def healthy(self) -> bool:
        return self.database and self.cache


def check_database() -> bool:
    """Vrai si la base répond à une requête triviale."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Health check: database unavailable (%s)", type(exc).__name__)
        return False
    return True


def check_cache() -> bool:
    """Vrai si le cache accepte une écriture puis la relit à l'identique."""
    key = f"health:{secrets.token_hex(8)}"
    value = secrets.token_hex(8)
    try:
        cache.set(key, value, timeout=5)
        ok = bool(cache.get(key) == value)
        cache.delete(key)
    except Exception as exc:  # chaque backend de cache lève ses propres exceptions
        logger.warning("Health check: cache unavailable (%s)", type(exc).__name__)
        return False
    return ok


def get_health_report() -> HealthReport:
    """Vérifie toutes les dépendances ; ne lève jamais d'exception."""
    return HealthReport(database=check_database(), cache=check_cache())
