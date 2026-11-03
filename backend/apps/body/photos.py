"""Photos de progression (ADR 0008) : vérification, réencodage sans métadonnées, stockage chiffré.

Le contenu est décodé par Pillow sur une liste blanche de formats : ni l'extension ni le type
annoncé ne comptent. L'orientation EXIF est appliquée, puis l'image est réencodée en WebP sans
aucune métadonnée (GPS, appareil, date). Les octets sont chiffrés (Fernet, ADR 0002) et écrits
sous un nom aléatoire dans `PRIVATE_MEDIA_ROOT`.
"""

import io
import os
import threading
import zipfile
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Final, Literal
from uuid import uuid4

from cryptography.fernet import InvalidToken
from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError

from common import crypto

Size = Literal["thumb", "large"]
# Côté long de chaque taille, en pixels : vignette de liste, image de comparaison.
SIZES: Final[dict[Size, int]] = {"thumb": 480, "large": 1600}
QUALITY: Final = 82
# Bombe de décompression : dimensions vérifiées avant tout décodage. Le JPEG (photo de
# téléphone, 12 à 50 Mpx) est décodé directement à taille réduite (`draft`) ; PNG et WebP sont
# décodés en entier : 16 Mpx au plus (64 Mo en RGBA), sinon un PNG de 250 Ko demande 800 Mo.
MAX_PIXELS: Final[dict[str, int]] = {"JPEG": 60_000_000, "PNG": 16_000_000, "WEBP": 16_000_000}
# Réencodages simultanés par processus : borne la mémoire face à des envois en parallèle.
_PROCESSING = threading.BoundedSemaphore(2)
# Taille maximale d'un envoi (octets), vérifiée aussi par le BFF.
MAX_UPLOAD_BYTES: Final = 15 * 1024 * 1024
# HEIC exclu : pas de décodeur dans Pillow sans greffon (les navigateurs envoient du JPEG).
FORMATS: Final = ("JPEG", "PNG", "WEBP")
SUFFIX: Final = ".bin"


class PhotoRejectedError(ValueError):
    """Fichier illisible, format refusé ou image hors limites."""


def process(data: bytes) -> dict[Size, bytes]:
    """WebP de chaque taille de `data`, sans métadonnées, ou `PhotoRejectedError`."""
    with _PROCESSING:
        return _process(data)


def _process(data: bytes) -> dict[Size, bytes]:
    try:
        with Image.open(io.BytesIO(data), formats=FORMATS) as source:
            width, height = source.size
            if width * height > MAX_PIXELS.get(source.format or "", 0):
                raise PhotoRejectedError("Image trop grande")
            # JPEG : décodage à taille réduite, sans l'image entière en mémoire.
            source.draft("RGB", (SIZES["large"], SIZES["large"]))
            # Orientation du téléphone appliquée avant que l'EXIF ne disparaisse.
            upright = ImageOps.exif_transpose(source)
            # Réduite tout de suite à la grande taille : les copies suivantes restent petites.
            upright.thumbnail((SIZES["large"], SIZES["large"]), Image.Resampling.LANCZOS)
            upright = upright.convert("RGB")
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        EOFError,
        Image.DecompressionBombError,
    ) as error:
        raise PhotoRejectedError("Image illisible") from error
    results: dict[Size, bytes] = {}
    for size, edge in SIZES.items():
        image = upright.copy()
        image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        # Aucune métadonnée héritée (profil ICC, EXIF, XMP) : nouvelle image, `info` vide.
        clean = Image.new("RGB", image.size)
        clean.paste(image)
        out = io.BytesIO()
        clean.save(out, format="WEBP", quality=QUALITY, method=4)
        results[size] = out.getvalue()
    return results


def _root() -> Path:
    return Path(settings.PRIVATE_MEDIA_ROOT)


def _path(key: str, size: Size) -> Path:
    # `key` vient toujours de `store` (hexadécimal) : aucun chemin choisi par le client.
    if not key.isalnum():
        msg = "Clé de fichier invalide"
        raise ValueError(msg)
    return _root() / f"{key}-{size}{SUFFIX}"


def store(images: dict[Size, bytes]) -> str:
    """Chiffre et écrit chaque taille ; renvoie la clé aléatoire qui les nomme."""
    key = uuid4().hex
    _root().mkdir(parents=True, exist_ok=True)
    for size, content in images.items():
        path = _path(key, size)
        # Création exclusive, lecture et écriture par l'utilisateur de l'app seulement.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as file:
            file.write(crypto.encrypt_bytes(content))
    return key


def read(key: str, size: Size) -> bytes:
    """Octets WebP déchiffrés ; `FileNotFoundError` si le fichier manque."""
    return crypto.decrypt_bytes(_path(key, size).read_bytes())


def remove(key: str) -> None:
    """Efface toutes les tailles d'une photo ; sans effet si elles n'existent plus."""
    for size in SIZES:
        _path(key, size).unlink(missing_ok=True)


def stored_keys() -> Iterator[tuple[str, float]]:
    """Clés présentes sur le disque et date de dernière modification (orphelins, ADR 0008)."""
    root = _root()
    if not root.is_dir():
        return
    seen: set[str] = set()
    for path in root.glob(f"*{SUFFIX}"):
        key = path.name.split("-", 1)[0]
        if key not in seen:
            seen.add(key)
            yield key, path.stat().st_mtime


class _Chunks(io.RawIOBase):
    """Flux d'écriture sans retour en arrière : `zipfile` y écrit, le générateur en vide les
    octets au fur et à mesure (archive envoyée sans fichier temporaire)."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def writable(self) -> bool:
        return True

    def write(self, data: object) -> int:
        chunk = bytes(data)  # type: ignore[call-overload]
        self._buffer += chunk
        return len(chunk)

    def drain(self) -> bytes:
        chunk = bytes(self._buffer)
        self._buffer.clear()
        return chunk


def archive(entries: Iterable[tuple[str, str]]) -> Iterator[bytes]:
    """Archive ZIP, en morceaux, des grandes images déchiffrées : `(nom, clé)` par photo.

    Une photo à la fois en mémoire, rien en clair sur le disque. Sans compression : le WebP
    l'est déjà. Un fichier manquant ou indéchiffrable (clé retirée trop tôt, fichier abîmé) est
    sauté et signalé dans `LISEZMOI.txt` : une photo illisible ne bloque pas les autres.
    """
    sink = _Chunks()
    skipped = 0
    with zipfile.ZipFile(sink, mode="w", compression=zipfile.ZIP_STORED) as bundle:
        for name, key in entries:
            try:
                content = read(key, "large")
            except (FileNotFoundError, InvalidToken):
                skipped += 1
                continue
            bundle.writestr(name, content)
            yield sink.drain()
        if skipped:
            bundle.writestr(
                "LISEZMOI.txt",
                f"{skipped} photo(s) n'ont pas pu être lues et manquent dans cette archive.\n"
                "Contactez le support pour les récupérer.\n",
            )
    yield sink.drain()
