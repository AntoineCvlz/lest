"""Normalisation des images d'exercices (ADR 0005) : même format pour toutes, quelle que soit
la source (photo, dessin, PNG transparent, GIF animé).

Carré de `SIZE` pixels, image entière centrée avec une marge sur un fond clair commun, WebP.
Le réencodage complet supprime toutes les métadonnées (EXIF, GPS, profils).
"""

import hashlib
import io
import struct
from dataclasses import dataclass
from typing import Final

from PIL import Image, ImageOps, UnidentifiedImageError

# À augmenter à chaque changement de rendu : l'import refait alors les images d'une version
# antérieure, sans toucher aux autres.
FORMAT_VERSION: Final = 1
SIZE: Final = 640
MARGIN: Final = 32
# Blanc : la plupart des images de wger ont déjà ce fond, le cadre reste ainsi uniforme.
BACKGROUND: Final = (0xFF, 0xFF, 0xFF)
QUALITY: Final = 80
# Bien au-delà d'une image d'exercice (quelques mégapixels) : protège de la « bombe de
# décompression » (petit fichier, image immense) avant tout décodage.
MAX_PIXELS: Final = 25_000_000
# Seuls décodeurs utilisés : un fichier d'un autre format (TGA, PSD, SGI…) est refusé sans être
# analysé, ce qui réduit la surface d'attaque des décodeurs de Pillow.
FORMATS: Final = ("PNG", "JPEG", "GIF", "WEBP")


class ImageRejectedError(ValueError):
    """Fichier illisible, ou image hors des limites (dimensions)."""


@dataclass(frozen=True)
class NormalizedImage:
    content: bytes
    # Empreinte SHA-256 du WebP produit : nom de fichier immuable (cache long) et dédoublonnage.
    digest: str


def normalize(data: bytes) -> NormalizedImage:
    """WebP carré `SIZE` x `SIZE` de l'image `data`, ou `ImageRejectedError`."""
    try:
        with Image.open(io.BytesIO(data), formats=FORMATS) as source:
            width, height = source.size
            if width * height > MAX_PIXELS:
                raise ImageRejectedError("Image trop grande")
            source.seek(0)  # GIF ou WebP animé : première image seulement
            # JPEG : décodage directement à taille réduite, sans l'image entière en mémoire.
            source.draft("RGB", (SIZE, SIZE))
            frame = source.convert("RGBA")
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        EOFError,
        SyntaxError,
        struct.error,
        Image.DecompressionBombError,
    ) as error:
        # Les décodeurs lèvent selon les cas l'une de ces exceptions sur un fichier abîmé.
        raise ImageRejectedError("Image illisible") from error

    inner = SIZE - 2 * MARGIN
    # Agrandie ou réduite pour occuper le cadre : même taille apparente pour toutes.
    frame = ImageOps.contain(frame, (inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (SIZE, SIZE), BACKGROUND)
    # La transparence (dessins au trait en PNG) se pose sur le fond clair commun.
    offset = ((SIZE - frame.width) // 2, (SIZE - frame.height) // 2)
    canvas.paste(frame, offset, mask=frame)
    output = io.BytesIO()
    canvas.save(output, format="WEBP", quality=QUALITY, method=6)
    content = output.getvalue()
    return NormalizedImage(content=content, digest=hashlib.sha256(content).hexdigest())
