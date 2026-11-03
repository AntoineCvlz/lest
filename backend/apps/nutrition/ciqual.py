"""Passerelle Ciqual (ADR 0009) : téléchargement et lecture de la table de l'Anses.

Fichiers XML de l'entrepôt Recherche Data Gouv (identifiants épinglés dans les réglages). La
seule redirection permise mène au stockage de l'INRAE, en https. Le XML est lu par `defusedxml`
(entités refusées : ni bombe XML ni entité externe) et en flux, élément par élément. Une source
malformée (code, doublon, teneur hors bornes) est refusée entière, avant la base.
"""

import http.client
import io
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Final, Protocol
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree.ElementTree import ParseError

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import iterparse

TIMEOUT_SECONDS: Final = 120
# `alim` fait 1,6 Mo et `compo` 70 Mo (version 2025) : une marge, pas l'infini.
MAX_BYTES: Final = 200 * 1024 * 1024
# Hôte du stockage vers lequel l'entrepôt redirige ses téléchargements.
STORAGE_HOST_SUFFIX: Final = ".stockage.inrae.fr"

# Constituants retenus (`const_code`), pour 100 g.
KCAL: Final = "328"  # Énergie, règlement UE n° 1169/2011 (kcal/100 g)
PROTEIN: Final = "25000"  # Protéines, N x facteur de Jones
CARBS: Final = "31000"  # Glucides
FAT: Final = "40000"  # Lipides
CONSTITUENTS: Final = {KCAL: "kcal", PROTEIN: "protein", CARBS: "carbs", FAT: "fat"}

# Bornes de la base (`Food`) : une teneur au-delà signale une source malformée.
MAX_KCAL: Final = Decimal(900)
MAX_GRAMS: Final = Decimal(100)
MAX_CODE_LENGTH: Final = 32

LICENSE: Final = "Table Ciqual 2025, Anses, Licence Ouverte Etalab 2.0 (doi:10.57745/RDMHWY)"


class CiqualError(Exception):
    """Source injoignable, réponse inattendue ou données illisibles."""


@dataclass(frozen=True)
class CiqualFood:
    code: str
    name: str
    kcal: Decimal
    protein: Decimal | None
    carbs: Decimal | None
    fat: Decimal | None


def parse_amount(text: str | None) -> Decimal | None:
    """Teneur Ciqual : virgule décimale ; « - » inconnu (`None`) ; « traces » et « < x » (sous le
    seuil de quantification) comptés 0."""
    value = (text or "").strip()
    if value in ("", "-"):
        return None
    if value == "traces" or value.startswith("<"):
        return Decimal(0)
    try:
        amount = Decimal(value.replace(",", "."))
    except InvalidOperation as error:
        raise CiqualError("Teneur illisible") from error
    if not amount.is_finite() or amount < 0:
        raise CiqualError("Teneur hors plage")
    return amount


def _records(data: bytes, tag: str) -> Iterator[dict[str, str]]:
    """Enregistrements `<tag>` d'un fichier XML Ciqual, en flux : `{élément: texte}`."""
    try:
        for _event, element in iterparse(io.BytesIO(data), events=("end",)):
            if element.tag == tag:
                yield {child.tag: (child.text or "").strip() for child in element}
                element.clear()
    # Entités (refusées par defusedxml), ou XML mal formé.
    except (DefusedXmlException, ParseError) as error:
        raise CiqualError(f"XML Ciqual illisible : {type(error).__name__}") from error


def parse_foods(alim: bytes, compo: bytes) -> list[CiqualFood]:
    """Aliments Ciqual avec leurs valeurs retenues ; ceux sans énergie connue sont écartés
    (inutilisables dans un journal)."""
    values: dict[str, dict[str, Decimal | None]] = {}
    for record in _records(compo, "COMPO"):
        key = CONSTITUENTS.get(record.get("const_code", ""))
        if key is not None:
            values.setdefault(record.get("alim_code", ""), {})[key] = parse_amount(
                record.get("teneur")
            )
    foods = []
    seen: set[str] = set()
    for record in _records(alim, "ALIM"):
        code = record.get("alim_code", "")
        name = record.get("alim_nom_fr", "")
        if not (code.isascii() and code.isdigit() and len(code) <= MAX_CODE_LENGTH):
            raise CiqualError("Code d'aliment inattendu")
        if code in seen:
            raise CiqualError("Code d'aliment en double")
        seen.add(code)
        found = values.get(code, {})
        kcal = found.get("kcal")
        if not name or kcal is None:
            continue
        _check_bounds(kcal, found)
        foods.append(
            CiqualFood(
                code=code,
                name=name[:200],
                kcal=kcal,
                protein=found.get("protein"),
                carbs=found.get("carbs"),
                fat=found.get("fat"),
            )
        )
    return foods


def _check_bounds(kcal: Decimal, found: dict[str, Decimal | None]) -> None:
    grams = [found.get(key) for key in ("protein", "carbs", "fat")]
    if kcal > MAX_KCAL or any(value is not None and value > MAX_GRAMS for value in grams):
        raise CiqualError("Teneur hors bornes")


class _StorageRedirectOnly(HTTPRedirectHandler):
    """Une redirection seulement, vers le stockage de l'INRAE et en https : chaque saut est
    vérifié ici, vers le réseau interne ou un autre hôte il est refusé."""

    max_redirections = 1

    def redirect_request(
        self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> Request | None:
        target = urlsplit(newurl)
        if target.scheme != "https" or not (target.hostname or "").endswith(STORAGE_HOST_SUFFIX):
            raise CiqualError("Redirection refusée")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = build_opener(_StorageRedirectOnly)


def urlopen(request: Request, *, timeout: int) -> Any:
    return _opener.open(request, timeout=timeout)


class _Response(Protocol):
    def read(self, amt: int, /) -> bytes: ...


# `urlopen`, ou un remplaçant en test : un gestionnaire de contexte qui donne une réponse lisible.
Opener = Callable[..., AbstractContextManager[_Response]]


def fetch_file(base_url: str, file_id: int, *, opener: Opener = urlopen) -> bytes:
    """Octets d'un fichier de l'entrepôt (`CIQUAL_BASE_URL` + identifiant épinglé)."""
    root = base_url.rstrip("/")
    if urlsplit(root).scheme != "https":
        raise CiqualError("Source Ciqual hors https")
    request = Request(f"{root}/{int(file_id)}", headers={"User-Agent": "Lest"})  # noqa: S310 — URL construite ici
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(MAX_BYTES + 1)
    except (OSError, http.client.HTTPException, ValueError) as error:
        raise CiqualError(f"Ciqual injoignable : {type(error).__name__}") from error
    if len(body) > MAX_BYTES:
        raise CiqualError("Réponse Ciqual trop volumineuse")
    return body
