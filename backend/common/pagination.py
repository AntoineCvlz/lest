"""Pagination par curseur (CLAUDE.md) : stable quand des lignes arrivent entre deux pages.

Le curseur est la clé de tri de la dernière ligne servie, encodée en base64 : opaque pour le
client, qui le renvoie tel quel. Il ne contient que des valeurs déjà visibles dans la page.
"""

import base64
import binascii
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from django.core.exceptions import ValidationError
from django.db.models import Model, Q, QuerySet

DEFAULT_LIMIT = 30
MAX_LIMIT = 100
# Pire cas : un nom de 200 caractères sur 4 octets et un UUID, en base64 (environ 1 100).
MAX_CURSOR_LENGTH = 2048


class InvalidCursorError(ValueError):
    """Curseur illisible : modifié, tronqué ou venu d'une autre liste."""


@dataclass(frozen=True)
class Page[M: Model]:
    items: list[M]
    next_cursor: str | None


def encode_cursor(values: Sequence[str]) -> str:
    raw = json.dumps(list(values), ensure_ascii=False, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, *, size: int) -> list[str]:
    """Valeurs du curseur (`size` chaînes), ou `InvalidCursorError`."""
    if len(cursor) > MAX_CURSOR_LENGTH:
        raise InvalidCursorError
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        values: Any = json.loads(raw)
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise InvalidCursorError from None
    if (
        not isinstance(values, list)
        or len(values) != size
        or not all(isinstance(value, str) for value in values)
    ):
        raise InvalidCursorError
    return values


def paginate[M: Model](
    queryset: QuerySet[M], *, keys: tuple[str, str], cursor: str | None, limit: int
) -> Page[M]:
    """
    Page de `queryset` triée par `keys` (un champ texte puis un champ unique, croissants).

    Lit `limit + 1` lignes pour savoir s'il en reste, sans compter la liste entière.
    """
    first, second = keys
    queryset = queryset.order_by(first, second)
    if cursor is not None:
        after_first, after_second = decode_cursor(cursor, size=2)
        try:
            queryset = queryset.filter(
                Q(**{f"{first}__gt": after_first})
                | Q(**{first: after_first, f"{second}__gt": after_second})
            )
        except (ValidationError, ValueError):  # ex. UUID mal formé dans le curseur
            raise InvalidCursorError from None
    rows = list(queryset[: limit + 1])
    items = rows[:limit]
    if len(rows) <= limit:
        return Page(items=items, next_cursor=None)
    last = items[-1]
    return Page(
        items=items,
        next_cursor=encode_cursor([str(getattr(last, first)), str(getattr(last, second))]),
    )
