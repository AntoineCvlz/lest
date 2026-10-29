"""Passerelle wger (ADR 0004) : seul module qui lit l'API de wger.

Il valide les pages de `exerciseinfo` (Pydantic) et les transforme en `WgerExercise`, sans rien
écrire en base : l'import (`services.import_wger_exercises`) ne reçoit que des données valides.
Toute réponse inattendue lève `WgerError` avant la moindre écriture.
"""

import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from urllib.error import URLError
from urllib.request import Request, urlopen
from uuid import UUID

from pydantic import BaseModel, ValidationError

from .models import Category

# Identifiants de langue de wger (`/api/v2/language/`).
FRENCH, ENGLISH = 12, 2
# Garde-fou : ~10 pages de 100 aujourd'hui (939 exercices) ; au-delà, réponse anormale.
MAX_PAGES = 50
PAGE_SIZE = 100
TIMEOUT_SECONDS = 30
# Une page réelle pèse ~100 Ko : au-delà de 5 Mo, réponse anormale, lue sans saturer la mémoire.
MAX_PAGE_BYTES = 5 * 1024 * 1024

# Données de référence de wger (`/api/v2/exercisecategory/`, `muscle/`, `equipment/`, vérifiées
# le 2026-10-29), avec des libellés français maison : wger donne des noms anglais ou latins.
CATEGORIES = {
    10: Category.ABS,
    8: Category.ARMS,
    12: Category.BACK,
    14: Category.CALVES,
    15: Category.CARDIO,
    11: Category.CHEST,
    9: Category.LEGS,
    13: Category.SHOULDERS,
}
MUSCLES: dict[int, tuple[str, bool]] = {
    # wger_id : (libellé, face avant du corps)
    1: ("Biceps", True),
    2: ("Deltoïde antérieur", True),
    3: ("Dentelé antérieur", True),
    4: ("Grand pectoral", True),
    5: ("Triceps", False),
    6: ("Grand droit (abdominaux)", True),
    7: ("Gastrocnémien", False),
    8: ("Grand fessier", False),
    9: ("Trapèze", False),
    10: ("Quadriceps", True),
    11: ("Ischio-jambiers", False),
    12: ("Grand dorsal", False),
    13: ("Brachial", True),
    14: ("Oblique externe", True),
    15: ("Soléaire", False),
}
EQUIPMENT = {
    1: "Barre",
    2: "Barre EZ",
    3: "Haltères",
    4: "Tapis",
    5: "Swiss ball",
    6: "Barre de traction",
    7: "Poids du corps",
    8: "Banc",
    9: "Banc incliné",
    10: "Kettlebell",
    11: "Élastique",
    12: "Poulie",
}
# Licences compatibles avec notre usage (attribution, partage à l'identique des données) ; un
# exercice sous toute autre licence est ignoré.
LICENSES = {
    "CC-BY-SA 4": "https://creativecommons.org/licenses/by-sa/4.0/",
    "CC-BY-SA 3": "https://creativecommons.org/licenses/by-sa/3.0/",
    "CC-BY 4": "https://creativecommons.org/licenses/by/4.0/",
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
}


class WgerError(Exception):
    """wger injoignable, ou réponse dont la forme n'est pas celle attendue."""


@dataclass(frozen=True)
class WgerExercise:
    uuid: UUID
    name_fr: str | None
    name_en: str | None
    category_id: int
    muscle_ids: tuple[int, ...]
    secondary_muscle_ids: tuple[int, ...]
    equipment_ids: tuple[int, ...]
    license: str
    license_author: str
    updated_at: datetime | None


class _Ref(BaseModel):
    id: int


class _Translation(BaseModel):
    language: int
    name: str


class _License(BaseModel):
    short_name: str


class _Exercise(BaseModel):
    uuid: UUID
    category: _Ref
    muscles: list[_Ref]
    muscles_secondary: list[_Ref]
    equipment: list[_Ref]
    translations: list[_Translation]
    license: _License
    license_author: str | None = None
    last_update_global: datetime | None = None


class _Page(BaseModel):
    next: str | None = None
    results: list[_Exercise]


def _name(item: _Exercise, language: int) -> str | None:
    names = (t.name.strip() for t in item.translations if t.language == language)
    return next((name for name in names if name), None)


def parse_page(payload: object) -> tuple[list[WgerExercise], str | None]:
    """Exercices d'une page de `exerciseinfo`, et l'URL de la page suivante."""
    try:
        page = _Page.model_validate(payload)
    except ValidationError as error:
        raise WgerError(f"Page wger inattendue ({error.error_count()} erreurs)") from error
    exercises = [
        WgerExercise(
            uuid=item.uuid,
            name_fr=_name(item, FRENCH),
            name_en=_name(item, ENGLISH),
            category_id=item.category.id,
            muscle_ids=tuple(ref.id for ref in item.muscles),
            secondary_muscle_ids=tuple(ref.id for ref in item.muscles_secondary),
            equipment_ids=tuple(ref.id for ref in item.equipment),
            license=item.license.short_name,
            license_author=(item.license_author or "").strip(),
            updated_at=item.last_update_global,
        )
        for item in page.results
    ]
    return exercises, page.next


class _Response(Protocol):
    def read(self, amt: int, /) -> bytes: ...


# `urlopen`, ou un remplaçant en test : un gestionnaire de contexte qui donne une réponse lisible.
Opener = Callable[..., AbstractContextManager[_Response]]


def fetch_exercises(base_url: str, *, opener: Opener = urlopen) -> list[WgerExercise]:
    """Toutes les pages de `exerciseinfo`. Ne suit que des pages du même serveur : une URL
    `next` ailleurs (réponse détournée) est refusée."""
    root = base_url.rstrip("/")
    url: str | None = f"{root}/exerciseinfo/?limit={PAGE_SIZE}"
    exercises: list[WgerExercise] = []
    for _ in range(MAX_PAGES):
        if url is None:
            return exercises
        if not url.startswith(f"{root}/"):
            raise WgerError("Page suivante hors du serveur wger")
        page, url = parse_page(_get_json(url, opener))
        exercises.extend(page)
    raise WgerError(f"Plus de {MAX_PAGES} pages : réponse anormale")


def _get_json(url: str, opener: Opener) -> Any:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "Lest"})  # noqa: S310 — URL fixée par la configuration
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(MAX_PAGE_BYTES + 1)
    except (URLError, TimeoutError) as error:
        raise WgerError(f"wger injoignable : {error}") from error
    if len(body) > MAX_PAGE_BYTES:
        raise WgerError("Page wger trop volumineuse")
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise WgerError(f"Réponse wger illisible : {error}") from error
