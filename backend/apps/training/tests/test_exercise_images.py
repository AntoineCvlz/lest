"""Images d'exercices (ADR 0005) : normalisation, téléchargement borné, import, service public.

Aucune image réelle dans le dépôt : les images de test sont générées par Pillow.
"""

import hashlib
import http.client
import io
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request
from uuid import UUID, uuid4

import pytest
from django.test import Client
from PIL import Image

from apps.training import images, services, wger
from apps.training.models import ExerciseImage
from apps.training.services import import_wger_exercises, import_wger_images
from apps.training.tests.test_workouts_api import API, Athlete

pytestmark = pytest.mark.django_db

BASE = "https://wger.example/api/v2"
BENCH = UUID("11111111-1111-4111-8111-111111111111")


@pytest.fixture(autouse=True)
def media_root(settings: Any, tmp_path: Path) -> Path:
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


def picture(size: tuple[int, int] = (300, 150), *, mode: str = "RGB", fmt: str = "PNG") -> bytes:
    color: Any = (200, 30, 30, 255) if mode == "RGBA" else (200, 30, 30)
    output = io.BytesIO()
    Image.new(mode, size, color).save(output, format=fmt)
    return output.getvalue()


def source(url: str, *, main: bool = True, author: str = "Jane") -> wger.WgerImage:
    return wger.WgerImage(
        uuid=uuid4(), url=url, is_main=main, license="CC-BY-SA 4", license_author=author
    )


def exercise(*image_sources: wger.WgerImage, uuid: UUID = BENCH) -> wger.WgerExercise:
    return wger.WgerExercise(
        uuid=uuid,
        name_fr="Développé couché",
        name_en="Bench press",
        category_id=11,
        muscle_ids=(4,),
        secondary_muscle_ids=(),
        equipment_ids=(1,),
        license="CC-BY-SA 4",
        license_author="wger",
        updated_at=None,
        images=image_sources,
    )


class Fetcher:
    """Double de `wger.fetch_image` : URL → octets, et le compte des téléchargements."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url not in self.files:
            raise wger.WgerError("injoignable")
        return self.files[url]


def pixel(data: bytes, xy: tuple[int, int]) -> tuple[int, int, int]:
    with Image.open(io.BytesIO(data)) as result:
        red, green, blue = result.convert("RGB").getpixel(xy)  # type: ignore[misc]
    return red, green, blue


def file_name() -> str:
    """Nom du fichier de l'image unique (ou de la première) en base."""
    image = ExerciseImage.objects.order_by("position").first()
    assert image is not None
    assert image.file.name
    return image.file.name


def run(*items: wger.WgerExercise, fetch: Fetcher) -> Any:
    import_wger_exercises(exercises=list(items))
    return import_wger_images(exercises=list(items), fetch=fetch)


# --- Normalisation ----------------------------------------------------------------------------


def test_every_image_becomes_the_same_square_webp() -> None:
    for data in (picture((300, 150)), picture((40, 90)), picture((1200, 1200), fmt="JPEG")):
        normalized = images.normalize(data)
        with Image.open(io.BytesIO(normalized.content)) as result:
            assert (result.format, result.size) == ("WEBP", (640, 640))
        # Marge sur le fond commun, image agrandie ou réduite pour occuper le cadre.
        assert pixel(normalized.content, (2, 2)) == pytest.approx(images.BACKGROUND, abs=3)


def test_transparency_lands_on_the_common_background() -> None:
    clear = io.BytesIO()
    Image.new("RGBA", (100, 100), (0, 0, 0, 0)).save(clear, format="PNG")

    center = pixel(images.normalize(clear.getvalue()).content, (320, 320))

    assert center == pytest.approx(images.BACKGROUND, abs=3)


def test_metadata_is_stripped() -> None:
    exif = Image.Exif()
    exif[0x010F] = "Appareil"  # Make
    exif[0x8825] = {2: (48.0, 51.0, 24.0)}  # GPSInfo
    output = io.BytesIO()
    Image.new("RGB", (200, 200), (10, 10, 10)).save(output, format="JPEG", exif=exif)

    with Image.open(io.BytesIO(images.normalize(output.getvalue()).content)) as result:
        assert not result.getexif()
        assert "exif" not in result.info


def test_an_animated_gif_keeps_its_first_frame() -> None:
    frames = [Image.new("RGB", (64, 64), color) for color in ((255, 0, 0), (0, 0, 255))]
    output = io.BytesIO()
    frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:])

    red, _, blue = pixel(images.normalize(output.getvalue()).content, (320, 320))

    assert red > 200 > blue


@pytest.mark.parametrize("fmt", ["TGA", "BMP", "TIFF", "PPM"])
def test_only_common_web_formats_are_decoded(fmt: str) -> None:
    with pytest.raises(images.ImageRejectedError):
        images.normalize(picture((20, 20), fmt=fmt))


def test_unreadable_or_oversized_images_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(images.ImageRejectedError):
        images.normalize(b"<svg/>")
    monkeypatch.setattr(images, "MAX_PIXELS", 100)
    with pytest.raises(images.ImageRejectedError):
        images.normalize(picture((20, 20)))


def test_the_digest_names_the_content() -> None:
    first, again = images.normalize(picture()), images.normalize(picture())

    assert first.digest == again.digest
    assert len(first.digest) == 64


# --- Téléchargement ---------------------------------------------------------------------------


def opener_serving(body: bytes) -> Any:
    @contextmanager
    def opener(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        yield io.BytesIO(body)

    return opener


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/media/a.png",
        "http://wger.example/media/a.png",
        "https://wger.example.evil.example/a.png",
        "https://wger.example@evil.example/a.png",
        "https://wger.example:444/a.png",
        "file:///etc/passwd",
    ],
)
def test_only_images_from_the_configured_wger_host_are_fetched(url: str) -> None:
    with pytest.raises(wger.WgerError):
        wger.fetch_image(url, base_url=BASE, opener=opener_serving(b"x"))


def test_an_oversized_or_unreachable_image_is_an_error() -> None:
    url = "https://wger.example/media/a.png"
    big = b"x" * (wger.MAX_IMAGE_BYTES + 1)
    with pytest.raises(wger.WgerError):
        wger.fetch_image(url, base_url=BASE, opener=opener_serving(big))

    @contextmanager
    def down(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        raise URLError("injoignable")
        yield io.BytesIO()

    with pytest.raises(wger.WgerError):
        wger.fetch_image(url, base_url=BASE, opener=down)
    assert wger.fetch_image(url, base_url=BASE, opener=opener_serving(b"ok")) == b"ok"


def test_redirections_are_refused() -> None:
    # Le contrôle d'hôte porte sur l'URL demandée : une redirection le contournerait.
    handler = wger._NoRedirect()
    with pytest.raises(wger.WgerError):
        handler.redirect_request(
            Request("https://wger.example/a.png"),
            io.BytesIO(),
            302,
            "Found",
            {},
            "http://169.254.169.254/latest/meta-data/",
        )


def test_a_broken_transfer_or_an_invalid_url_is_an_error() -> None:
    @contextmanager
    def truncated(request: Any, timeout: int) -> Iterator[Any]:
        class Body:
            def read(self, amt: int) -> bytes:
                raise http.client.IncompleteRead(b"")

        yield Body()

    with pytest.raises(wger.WgerError):
        wger.fetch_image("https://wger.example/a.png", base_url=BASE, opener=truncated)
    with pytest.raises(wger.WgerError):  # espace dans le chemin : refusé avant toute connexion
        wger.fetch_image("https://wger.example/media/a b.png", base_url=BASE)


def test_images_under_other_licenses_are_skipped_when_parsing() -> None:
    page = {
        "next": None,
        "results": [
            {
                "uuid": str(BENCH),
                "category": {"id": 11},
                "muscles": [],
                "muscles_secondary": [],
                "equipment": [],
                "translations": [{"language": 2, "name": "Bench press"}],
                "license": {"short_name": "CC-BY-SA 4"},
                "images": [
                    {"uuid": str(uuid4()), "image": "https://wger.example/a.png", "license": 2},
                    {"uuid": str(uuid4()), "image": "https://wger.example/b.png", "license": 5},
                ],
            }
        ],
    }

    [parsed], _ = wger.parse_page(page)

    assert [image.license for image in parsed.images] == ["CC-BY-SA 4"]


def test_images_reviewed_as_unrelated_are_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    excluded = uuid4()
    monkeypatch.setattr(wger, "EXCLUDED_IMAGES", frozenset({excluded}))
    page = {
        "next": None,
        "results": [
            {
                "uuid": str(BENCH),
                "category": {"id": 11},
                "muscles": [],
                "muscles_secondary": [],
                "equipment": [],
                "translations": [{"language": 2, "name": "Bench press"}],
                "license": {"short_name": "CC-BY-SA 4"},
                "images": [
                    {"uuid": str(excluded), "image": "https://wger.example/logo.png", "license": 2}
                ],
            }
        ],
    }

    [parsed], _ = wger.parse_page(page)

    assert parsed.images == ()


# --- Import -----------------------------------------------------------------------------------


def test_images_are_imported_normalised_and_attributed(media_root: Path) -> None:
    main = source("https://wger.example/main.png", author="Jane")
    other = source("https://wger.example/other.png", main=False, author="")
    fetch = Fetcher({main.url: picture(), other.url: picture((50, 80))})

    report = run(exercise(other, main), fetch=fetch)

    assert (report.imported, report.failed) == (2, 0)
    stored = list(ExerciseImage.objects.all())
    assert [image.license_author for image in stored] == ["Jane", ""]  # principale d'abord
    for image in stored:
        assert image.file.name == f"exercises/{image.digest}.webp"
        assert (media_root / image.file.name).read_bytes()[:4] == b"RIFF"  # en-tête WebP


def test_a_rerun_downloads_nothing_new() -> None:
    main = source("https://wger.example/main.png")
    fetch = Fetcher({main.url: picture()})
    run(exercise(main), fetch=fetch)

    report = run(exercise(main), fetch=fetch)

    assert (report.imported, report.unchanged) == (0, 1)
    assert fetch.calls == [main.url]


def test_a_new_format_version_redoes_the_images(monkeypatch: pytest.MonkeyPatch) -> None:
    main = source("https://wger.example/main.png")
    fetch = Fetcher({main.url: picture()})
    run(exercise(main), fetch=fetch)

    monkeypatch.setattr(services, "FORMAT_VERSION", images.FORMAT_VERSION + 1)
    report = run(exercise(main), fetch=fetch)

    assert report.imported == 1
    assert ExerciseImage.objects.get().format_version == images.FORMAT_VERSION + 1
    assert fetch.calls == [main.url, main.url]


def test_a_changed_source_is_downloaded_again_and_the_old_file_removed(
    media_root: Path,
) -> None:
    main = source("https://wger.example/v1.png")
    fetch = Fetcher(
        {main.url: picture((300, 150)), "https://wger.example/v2.png": picture((90, 90))}
    )
    run(exercise(main), fetch=fetch)
    before = file_name()

    changed = wger.WgerImage(**{**main.__dict__, "url": "https://wger.example/v2.png"})
    run(exercise(changed), fetch=fetch)

    after = file_name()
    assert after != before
    assert not (media_root / before).exists()
    assert (media_root / after).exists()


def test_images_wger_no_longer_lists_are_removed_with_their_file(media_root: Path) -> None:
    main = source("https://wger.example/main.png")
    run(exercise(main), fetch=Fetcher({main.url: picture()}))
    name = file_name()

    report = run(exercise(), fetch=Fetcher({}))

    assert report.removed == 1
    assert not ExerciseImage.objects.exists()
    assert not (media_root / name).exists()


def test_a_shared_file_stays_until_its_last_image_goes(media_root: Path) -> None:
    first = source("https://wger.example/a.png")
    twin = source("https://wger.example/b.png", main=False)
    same = picture()
    run(exercise(first, twin), fetch=Fetcher({first.url: same, twin.url: same}))
    name = file_name()

    run(exercise(first), fetch=Fetcher({}))

    assert (media_root / name).exists()


def test_one_failing_image_does_not_stop_the_others_nor_the_cleanup() -> None:
    old = source("https://wger.example/old.png")
    run(exercise(old), fetch=Fetcher({old.url: picture()}))
    broken = source("https://wger.example/broken.png")
    fine = source("https://wger.example/fine.png", main=False)

    report = run(exercise(broken, fine), fetch=Fetcher({fine.url: picture((60, 60))}))

    assert (report.imported, report.failed, report.removed) == (1, 1, 1)
    assert [image.source_url for image in ExerciseImage.objects.all()] == [fine.url]


def test_a_damaged_or_missing_file_is_written_again(media_root: Path) -> None:
    main = source("https://wger.example/main.png")
    fetch = Fetcher({main.url: picture()})
    run(exercise(main), fetch=fetch)
    stored = media_root / file_name()

    stored.unlink()  # fichier perdu : l'image n'est plus « inchangée »
    run(exercise(main), fetch=fetch)
    assert stored.exists()

    stored.write_bytes(b"RIFF tronque")  # écriture interrompue
    ExerciseImage.objects.update(format_version=0)
    run(exercise(main), fetch=fetch)
    digest = ExerciseImage.objects.get().digest
    assert hashlib.sha256(stored.read_bytes()).hexdigest() == digest


def test_a_failed_image_is_counted_and_the_import_goes_on() -> None:
    broken = source("https://wger.example/broken.png")
    missing = source("https://wger.example/missing.png", main=False)
    fetch = Fetcher({broken.url: b"not an image"})

    report = run(exercise(broken, missing), fetch=fetch)

    assert (report.imported, report.failed) == (0, 2)
    assert not ExerciseImage.objects.exists()


def test_images_of_an_exercise_skipped_by_the_catalog_are_ignored() -> None:
    main = source("https://wger.example/main.png")
    fetch = Fetcher({main.url: picture()})

    report = import_wger_images(exercises=[exercise(main)], fetch=fetch)  # catalogue non importé

    assert report.imported == 0
    assert fetch.calls == []


# --- API --------------------------------------------------------------------------------------


def test_the_catalog_gives_the_main_image_and_the_sheet_all_of_them() -> None:
    main = source("https://wger.example/main.png", author="Jane")
    other = source("https://wger.example/other.png", main=False)
    run(exercise(other, main), fetch=Fetcher({main.url: picture(), other.url: picture((80, 40))}))
    athlete = Athlete()

    [item] = athlete.get("/exercises/").json()["items"]
    sheet = athlete.get(f"/exercises/{item['id']}/").json()

    assert item["image"]["license_author"] == "Jane"
    assert item["image"]["url"].startswith("/api/v1/exercise-images/")
    assert sheet["images"][0]["url"] == item["image"]["url"]
    assert len(sheet["images"]) == 2


def test_an_exercise_without_image_says_so() -> None:
    run(exercise(), fetch=Fetcher({}))

    [item] = Athlete().get("/exercises/").json()["items"]

    assert item["image"] is None


def test_images_are_served_publicly_with_a_long_immutable_cache() -> None:
    main = source("https://wger.example/main.png")
    run(exercise(main), fetch=Fetcher({main.url: picture()}))
    digest = ExerciseImage.objects.get().digest

    response = Client().get(f"{API}/exercise-images/{digest}.webp")

    assert response.status_code == 200
    assert response["Content-Type"] == "image/webp"
    assert response["Cache-Control"] == "public, max-age=31536000, immutable"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert b"".join(response.streaming_content)[:4] == b"RIFF"  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "name",
    [
        "0" * 64 + ".webp",  # inconnue
        "../../config/settings.py",
        "0" * 64 + ".png",
        "ABCDEF" + "0" * 58 + ".webp",
    ],
)
def test_only_known_digests_are_served(name: str) -> None:
    assert Client().get(f"{API}/exercise-images/{name}").status_code == 404


def test_the_workout_detail_gives_each_exercise_its_image_and_category() -> None:
    main = source("https://wger.example/main.png")
    run(exercise(main), fetch=Fetcher({main.url: picture()}))
    athlete = Athlete()
    [item] = athlete.get("/exercises/").json()["items"]
    workout_id, line_id = uuid4(), uuid4()
    athlete.put(f"/workouts/{workout_id}/", {"started_at": "2026-10-29T18:00:00+01:00"})
    athlete.put(
        f"/workout-exercises/{line_id}/",
        {"workout_id": str(workout_id), "exercise_id": item["id"], "position": 0},
    )

    [line] = athlete.get(f"/workouts/{workout_id}/").json()["exercises"]

    assert line["exercise_image"] == item["image"]
    assert line["exercise_category"] == "chest"
