"""Passerelle RepDB (ADR 0006) : seul module qui lit le jeu de données RepDB.

Il valide `exercises.json` (Pydantic) et le transforme en `RepdbExercise`, sans rien écrire en
base : l'import (`services.import_exercises`) ne reçoit que des données valides. Rien du jeu
de données n'est conservé dans notre dépôt (licence RepDB, point 3).
"""

import http.client
import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import BaseModel, ValidationError

from .models import Category

TIMEOUT_SECONDS = 30
# `exercises.json` pèse ~3 Mo (701 exercices, 3 langues) : au-delà de 20 Mo, réponse anormale.
MAX_CATALOG_BYTES = 20 * 1024 * 1024
# Images de 512 px en WebP, quelques dizaines de Ko : au-delà de 5 Mo, réponse anormale.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
LICENSE = "RepDB free tier v1.0"
AUTHOR = "RepDB"

# Partie du corps (`body_part`) de RepDB → nos catégories ; la catégorie « cardio » de RepDB
# prime. Vocabulaire vérifié le 2026-11-02 sur le jeu complet.
BODY_PARTS = {
    "core": Category.ABS,
    "upper_arms": Category.ARMS,
    "lower_arms": Category.ARMS,
    "back": Category.BACK,
    "lower_legs": Category.CALVES,
    "chest": Category.CHEST,
    "upper_legs": Category.LEGS,
    "shoulders": Category.SHOULDERS,
    "full_body": Category.FULL_BODY,
}
# Muscles de RepDB → (libellé français, face avant du corps). Notre vocabulaire.
MUSCLES: dict[str, tuple[str, bool]] = {
    "abductors": ("Abducteurs", False),
    "adductors": ("Adducteurs", True),
    "anterior_deltoid": ("Deltoïde antérieur", True),
    "biceps_brachii": ("Biceps", True),
    "brachialis": ("Brachial", True),
    "brachioradialis": ("Brachio-radial", True),
    "erector_spinae": ("Érecteurs du rachis", False),
    "forearm_extensors": ("Extenseurs de l'avant-bras", False),
    "forearm_flexors": ("Fléchisseurs de l'avant-bras", True),
    "forearms": ("Avant-bras", True),
    "gastrocnemius": ("Gastrocnémien", False),
    "gluteus_maximus": ("Grand fessier", False),
    "gluteus_medius": ("Moyen fessier", False),
    "hamstrings": ("Ischio-jambiers", False),
    "hip_flexors": ("Fléchisseurs de la hanche", True),
    "infraspinatus_teres_minor": ("Infra-épineux et petit rond", False),
    "lateral_deltoid": ("Deltoïde moyen", True),
    "latissimus_dorsi": ("Grand dorsal", False),
    "obliques": ("Obliques", True),
    "pectoralis_major": ("Grand pectoral", True),
    "posterior_deltoid": ("Deltoïde postérieur", False),
    "quadratus_lumborum": ("Carré des lombes", False),
    "quadriceps": ("Quadriceps", True),
    "rectus_abdominis": ("Grand droit (abdominaux)", True),
    "rhomboids": ("Rhomboïdes", False),
    "serratus_anterior": ("Dentelé antérieur", True),
    "soleus": ("Soléaire", False),
    "supraspinatus": ("Supra-épineux", False),
    "tibialis_anterior": ("Tibial antérieur", True),
    "transverse_abdominis": ("Transverse de l'abdomen", True),
    "trapezius": ("Trapèze", False),
    "triceps_brachii": ("Triceps", False),
}
# Équipements de RepDB → libellé français. Un équipement inconnu garde son code, lisible.
EQUIPMENT = {
    "ab_wheel": "Roue abdominale",
    "air_bike": "Vélo à air",
    "assisted_pullup_machine": "Machine de traction assistée",
    "barbell": "Barre",
    "battle_rope": "Corde ondulatoire",
    "bicycle": "Vélo",
    "bosu_ball": "Bosu",
    "cable": "Poulie",
    "chest_press_machine": "Presse à pectoraux",
    "dip_machine": "Machine à dips",
    "dip_station": "Barres parallèles",
    "dumbbell": "Haltères",
    "elliptical": "Vélo elliptique",
    "ez_bar": "Barre EZ",
    "flat_bench": "Banc plat",
    "hack_squat": "Hack squat",
    "hip_abduction_machine": "Machine à abducteurs",
    "hip_adduction_machine": "Machine à adducteurs",
    "jump_rope": "Corde à sauter",
    "kettlebell": "Kettlebell",
    "lat_pulldown_machine": "Machine de tirage vertical",
    "leg_curl": "Machine leg curl",
    "leg_extension": "Machine leg extension",
    "leg_press": "Presse à cuisses",
    "loop_band": "Mini-bande",
    "plate_loaded_lateral_raise_machine": "Machine d'élévations latérales",
    "plates": "Disques",
    "plyo_box": "Box de pliométrie",
    "pull_up_bar": "Barre de traction",
    "resistance_band": "Élastique",
    "rings": "Anneaux",
    "seated_row_machine": "Machine de rowing",
    "shoulder_press_machine": "Presse à épaules",
    "sled": "Traîneau",
    "smith_machine": "Smith machine",
    "stability_ball": "Swiss ball",
    "standing_calf_raise_machine": "Machine à mollets",
    "suspension_trainer": "Sangles de suspension",
    "trap_bar": "Trap bar",
    "treadmill": "Tapis de course",
}
Pose = Literal["start", "peak", "main"]
POSES: tuple[Pose, ...] = ("start", "peak", "main")


class RepdbError(Exception):
    """RepDB injoignable, ou réponse dont la forme n'est pas celle attendue."""


@dataclass(frozen=True)
class RepdbImage:
    pose: Pose
    # Chemin relatif au dépôt RepDB (`images/flat/…webp`).
    path: str


@dataclass(frozen=True)
class RepdbExercise:
    id: str
    name: str
    category: Category
    muscle_codes: tuple[str, ...]
    secondary_muscle_codes: tuple[str, ...]
    equipment_codes: tuple[str, ...]
    images: tuple[RepdbImage, ...]


class _Images(BaseModel):
    flat: dict[str, str]


class _Exercise(BaseModel):
    id: str
    name_en: str
    category: str
    body_part: str
    primary_muscles: list[str] = []
    secondary_muscles: list[str] = []
    equipment: str | None = None
    images: _Images


class _Catalog(BaseModel):
    exercises: list[_Exercise]


def _category(item: _Exercise) -> Category | None:
    if item.category == "cardio":
        return Category.CARDIO
    return BODY_PARTS.get(item.body_part)


def _image_path(path: str) -> bool:
    # Chemin du dépôt RepDB, sans remontée ni schéma : jamais une URL complète venue du JSON.
    return path.startswith("images/") and path.endswith(".webp") and ".." not in path


def parse_catalog(payload: object) -> list[RepdbExercise]:
    """Exercices exploitables de `exercises.json` : un exercice sans nom, de catégorie
    inconnue ou à l'identifiant mal formé est ignoré ; une forme inattendue lève `RepdbError`."""
    try:
        catalog = _Catalog.model_validate(payload)
    except ValidationError as error:
        raise RepdbError(f"Catalogue RepDB inattendu ({error.error_count()} erreurs)") from error
    exercises: list[RepdbExercise] = []
    for item in catalog.exercises:
        category = _category(item)
        name = item.name_en.strip()
        if category is None or not name or not item.id.replace("-", "").isalnum():
            continue
        exercises.append(
            RepdbExercise(
                id=item.id[:100],
                name=name[:200],
                category=category,
                muscle_codes=tuple(item.primary_muscles),
                secondary_muscle_codes=tuple(item.secondary_muscles),
                equipment_codes=(item.equipment,) if item.equipment else (),
                images=tuple(
                    RepdbImage(pose=pose, path=item.images.flat[pose])
                    for pose in POSES
                    if pose in item.images.flat and _image_path(item.images.flat[pose])
                ),
            )
        )
    return exercises


class _NoRedirect(HTTPRedirectHandler):
    """Refuse toute redirection : le contrôle d'hôte porte sur l'URL demandée, une redirection
    le contournerait (vers le réseau interne, par exemple)."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        raise RepdbError("Redirection refusée")


_opener = build_opener(_NoRedirect)


def urlopen(request: Request, *, timeout: int) -> Any:
    return _opener.open(request, timeout=timeout)


class _Response(Protocol):
    def read(self, amt: int, /) -> bytes: ...


# `urlopen`, ou un remplaçant en test : un gestionnaire de contexte qui donne une réponse lisible.
Opener = Callable[..., AbstractContextManager[_Response]]


def _get(url: str, *, limit: int, opener: Opener) -> bytes:
    request = Request(url, headers={"User-Agent": "Lest"})  # noqa: S310 — URL construite ici
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(limit + 1)
    except (OSError, http.client.HTTPException, ValueError) as error:
        raise RepdbError(f"RepDB injoignable : {type(error).__name__}") from error
    if len(body) > limit:
        raise RepdbError("Réponse RepDB trop volumineuse")
    return body


def _root(base_url: str) -> str:
    root = base_url.rstrip("/")
    if urlsplit(root).scheme != "https":
        raise RepdbError("Source RepDB hors https")
    return root


def fetch_catalog(base_url: str, *, opener: Opener = urlopen) -> list[RepdbExercise]:
    """`exercises.json` de la source configurée (`REPDB_BASE_URL`)."""
    body = _get(f"{_root(base_url)}/exercises.json", limit=MAX_CATALOG_BYTES, opener=opener)
    try:
        return parse_catalog(json.loads(body))
    except json.JSONDecodeError as error:
        raise RepdbError("Catalogue RepDB illisible") from error


def fetch_image(path: str, *, base_url: str, opener: Opener = urlopen) -> bytes:
    """Octets d'une image du dépôt RepDB. Seuls des chemins `images/…webp` sont acceptés : le
    JSON ne peut pas faire appeler un autre hôte."""
    if not _image_path(path):
        raise RepdbError("Chemin d'image inattendu")
    return _get(f"{_root(base_url)}/{path}", limit=MAX_IMAGE_BYTES, opener=opener)
