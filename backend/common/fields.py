"""Champs de modèle chiffrés au repos (ADR 0002, ADR 0007).

La valeur est formatée à précision fixe puis chiffrée par `common.crypto` (Fernet) : la base ne
voit qu'un jeton, de longueur indépendante de la valeur. Elle ne peut donc ni trier, ni filtrer,
ni borner ces champs : les seules recherches permises sont `isnull`, les bornes sont vérifiées par
les services et les calculs se font en Python.

Attention : `order_by`, `Max`, `Min` sur ces champs ne lèvent pas d'erreur mais comparent les
jetons, pas les valeurs : résultat faux sans avertissement. Toujours déchiffrer, puis calculer.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import models
from django.db.models.lookups import IsNull, Lookup

from common import crypto

if TYPE_CHECKING:
    _DecimalBase = models.Field[Decimal | None, Decimal | None]
else:
    _DecimalBase = models.Field


class EncryptedDecimalField(_DecimalBase):
    """Décimal chiffré, arrondi à `decimal_places` chiffres avant chiffrement."""

    description = "Décimal chiffré (Fernet)"

    def __init__(self, *args: Any, decimal_places: int, **kwargs: Any) -> None:
        self.decimal_places = decimal_places
        super().__init__(*args, **kwargs)

    def deconstruct(self) -> Any:
        name, path, args, kwargs = super().deconstruct()
        kwargs["decimal_places"] = self.decimal_places
        return name, path, args, kwargs

    def get_internal_type(self) -> str:
        return "TextField"

    def get_lookup(self, lookup_name: str) -> "type[Lookup[Any]] | None":
        # Un jeton Fernet change à chaque chiffrement : `exact`, `lt`… ne trouveraient rien.
        return IsNull if lookup_name == "isnull" else None

    def get_prep_value(self, value: Any) -> str | None:
        if value is None:
            return None
        # Ni texte ni flottant : une saisie non validée ne doit pas arriver chiffrée en base.
        if isinstance(value, bool) or not isinstance(value, Decimal | int):
            msg = f"{type(self).__name__} attend un Decimal."
            raise TypeError(msg)
        rounded = Decimal(value).quantize(Decimal(1).scaleb(-self.decimal_places))
        return crypto.encrypt(f"{rounded:.{self.decimal_places}f}")

    def from_db_value(self, value: str | None, expression: Any, connection: Any) -> Decimal | None:
        return None if value is None else Decimal(crypto.decrypt(value))

    def to_python(self, value: Any) -> Decimal | None:
        return None if value is None else Decimal(value)


if TYPE_CHECKING:
    _TextBase = models.Field[str | None, str | None]
else:
    _TextBase = models.Field

# Bourrage du texte avant chiffrement : la longueur du jeton ne révèle la longueur du texte
# qu'à ce bloc près.
TEXT_BLOCK = 64
_PAD = "\x00"


class EncryptedTextField(_TextBase):
    """Texte chiffré, complété par des NUL jusqu'à un multiple de `TEXT_BLOCK` octets (un texte
    accepté n'en contient jamais : `common.text.printable`). Mêmes limites que
    `EncryptedDecimalField` : ni filtre, ni tri, ni agrégat en base."""

    description = "Texte chiffré (Fernet)"

    def get_internal_type(self) -> str:
        return "TextField"

    def get_lookup(self, lookup_name: str) -> "type[Lookup[Any]] | None":
        return IsNull if lookup_name == "isnull" else None

    def get_prep_value(self, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or _PAD in value:
            msg = f"{type(self).__name__} attend un texte sans NUL."
            raise TypeError(msg)
        size = len(value.encode())
        padded = value + _PAD * (-size % TEXT_BLOCK or (0 if size else TEXT_BLOCK))
        return crypto.encrypt(padded)

    def from_db_value(self, value: str | None, expression: Any, connection: Any) -> str | None:
        return None if value is None else crypto.decrypt(value).rstrip(_PAD)

    def to_python(self, value: Any) -> str | None:
        return None if value is None else str(value)
