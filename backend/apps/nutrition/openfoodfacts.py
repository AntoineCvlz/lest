"""Passerelle Open Food Facts (ADR 0009) : lecture d'un produit au scan de son code-barres.

Un appel par scan réel, jamais pour la recherche (10 recherches par minute et par IP chez OFF,
partagées par tous les comptes). User-Agent identifié comme OFF le demande, aucune redirection,
réponse bornée, et validation stricte : seul un produit exploitable sort d'ici.
"""

import http.client
import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final, Protocol
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import BaseModel, ConfigDict, Field, ValidationError

TIMEOUT_SECONDS: Final = 10
MAX_BYTES: Final = 1024 * 1024
FIELDS: Final = "code,product_name,product_name_fr,brands,serving_quantity,nutriments"
# Bornes de la base (`Food`) : au-delà, une saisie erronée chez OFF.
MAX_KCAL: Final = Decimal(900)
MAX_GRAMS: Final = Decimal(100)
MAX_SERVING_G: Final = Decimal(2000)

LICENSE: Final = "Données Open Food Facts, sous licence ODbL (openfoodfacts.org)"


class OffError(Exception):
    """OFF injoignable ou réponse inattendue (rien n'est conclu sur le produit)."""


@dataclass(frozen=True)
class OffProduct:
    code: str
    name: str
    brand: str
    kcal: Decimal
    protein: Decimal | None
    carbs: Decimal | None
    fat: Decimal | None
    serving_g: Decimal | None


class UnusableProductError(Exception):
    """Produit connu d'OFF mais inexploitable : sans nom, sans énergie, ou valeurs aberrantes."""


def valid_barcode(code: str) -> bool:
    """Code GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) avec sa clé de contrôle : une faute de frappe
    ne coûte pas d'appel à OFF."""
    if not (code.isascii() and code.isdigit() and len(code) in (8, 12, 13, 14)):
        return False
    digits = [int(char) for char in code]
    body, check = digits[:-1], digits[-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


class _Nutriments(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kcal: Decimal | None = Field(None, alias="energy-kcal_100g")
    protein: Decimal | None = Field(None, alias="proteins_100g")
    carbs: Decimal | None = Field(None, alias="carbohydrates_100g")
    fat: Decimal | None = Field(None, alias="fat_100g")


class _Product(BaseModel):
    product_name_fr: str | None = None
    product_name: str | None = None
    brands: str | None = None
    serving_quantity: Decimal | None = None
    nutriments: _Nutriments = _Nutriments()


class _Answer(BaseModel):
    status: int
    product: _Product | None = None


def _grams(value: Decimal | None) -> Decimal | None:
    if value is None:
        return None
    if not value.is_finite() or not Decimal(0) <= value <= MAX_GRAMS:
        raise UnusableProductError
    return value.quantize(Decimal("0.1"))


def parse_product(code: str, payload: object) -> OffProduct | None:
    """Produit exploitable, `None` si OFF ne le connaît pas. Lève `UnusableProductError` s'il
    est connu mais inexploitable, `OffError` si la réponse n'a pas la forme attendue."""
    try:
        answer = _Answer.model_validate(payload)
    except ValidationError as error:
        raise OffError("Réponse OFF inattendue") from error
    if answer.status != 1 or answer.product is None:
        return None
    product = answer.product
    name = (product.product_name_fr or product.product_name or "").strip()
    kcal = product.nutriments.kcal
    if not name or kcal is None or not kcal.is_finite() or not Decimal(0) <= kcal <= MAX_KCAL:
        raise UnusableProductError
    serving = product.serving_quantity
    if serving is not None and not (serving.is_finite() and Decimal(0) < serving <= MAX_SERVING_G):
        serving = None
    return OffProduct(
        code=code,
        name=name[:200],
        # Première marque seulement : OFF les liste séparées par des virgules.
        brand=(product.brands or "").split(",")[0].strip()[:120],
        kcal=kcal.quantize(Decimal("0.1")),
        protein=_grams(product.nutriments.protein),
        carbs=_grams(product.nutriments.carbs),
        fat=_grams(product.nutriments.fat),
        serving_g=None if serving is None else serving.quantize(Decimal("0.1")),
    )


class _NoRedirect(HTTPRedirectHandler):
    """Aucune redirection : l'hôte contrôlé est celui des réglages, et lui seul."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        raise OffError("Redirection refusée")


_opener = build_opener(_NoRedirect)


def urlopen(request: Request, *, timeout: int) -> Any:
    return _opener.open(request, timeout=timeout)


class _Response(Protocol):
    def read(self, amt: int, /) -> bytes: ...


# `urlopen`, ou un remplaçant en test : un gestionnaire de contexte qui donne une réponse lisible.
Opener = Callable[..., AbstractContextManager[_Response]]


def fetch_product(
    code: str, *, base_url: str, contact: str, opener: Opener = urlopen
) -> OffProduct | None:
    """Produit `code` (déjà validé par `valid_barcode`) lu chez OFF. Voir `parse_product`."""
    root = base_url.rstrip("/")
    if urlsplit(root).scheme != "https" or not valid_barcode(code):
        raise OffError("Requête OFF refusée")
    request = Request(  # noqa: S310 — URL construite ici, code-barres validé
        f"{root}/api/v2/product/{code}?fields={FIELDS}",
        headers={"User-Agent": f"Lest/1.0 ({contact})", "Accept": "application/json"},
    )
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(MAX_BYTES + 1)
    except HTTPError as error:
        # Produit inconnu : OFF répond d'ordinaire 200 et `status: 0`, parfois 404.
        if error.code == 404:
            return None
        raise OffError(f"OFF a répondu {error.code}") from error
    except (OSError, http.client.HTTPException, ValueError) as error:
        raise OffError(f"OFF injoignable : {type(error).__name__}") from error
    if len(body) > MAX_BYTES:
        raise OffError("Réponse OFF trop volumineuse")
    try:
        return parse_product(code, json.loads(body))
    except json.JSONDecodeError as error:
        raise OffError("Réponse OFF illisible") from error
