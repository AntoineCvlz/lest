"""Catalogue RepDB (ADR 0006) : passerelle, normalisation, import, images, commande et tâche.

Aucune donnée RepDB dans le dépôt (licence, point 3) : exercices fictifs au même format, images
générées par Pillow.
"""

import hashlib
import http.client
import io
import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.error import URLError
from urllib.request import Request
from uuid import uuid4

import pytest
from celery.schedules import crontab
from django.conf import settings
from django.core.management import CommandError, call_command
from django.test import Client
from PIL import Image

from apps.training import images, repdb, services
from apps.training.models import Category, Equipment, Exercise, ExerciseImage, Muscle
from apps.training.services import EmptyCatalogError, import_exercises, import_images
from apps.training.tasks import import_exercises as import_task
from apps.training.tests.test_workouts_api import API, STARTED, Athlete

pytestmark = pytest.mark.django_db

BASE = "https://repdb.example/main"


@pytest.fixture(autouse=True)
def media_root(settings: Any, tmp_path: Path) -> Path:
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return Path(settings.MEDIA_ROOT)


def entry(identifier: str = "test-press", **overrides: Any) -> dict[str, Any]:
    """Exercice fictif au format de `exercises.json` de RepDB."""
    return {
        "id": identifier,
        "name_en": "Test Press",
        "category": "strength",
        "body_part": "chest",
        "primary_muscles": ["pectoralis_major"],
        "secondary_muscles": ["triceps_brachii"],
        "equipment": "barbell",
        "images": {
            "flat": {
                "start": f"images/flat/{identifier}-start.webp",
                "peak": f"images/flat/{identifier}-peak.webp",
            }
        },
        **overrides,
    }


def catalog(*entries: dict[str, Any]) -> list[repdb.RepdbExercise]:
    return repdb.parse_catalog({"exercises": list(entries)})


def picture(size: tuple[int, int] = (512, 512), *, fmt: str = "WEBP") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, (200, 220, 240)).save(output, format=fmt)
    return output.getvalue()


class Fetcher:
    """Double de `repdb.fetch_image` : chemin → octets, et les chemins demandés."""

    def __init__(self, files: dict[str, bytes] | None = None, *, default: bytes | None = None):
        self.files = files or {}
        self.default = default
        self.calls: list[str] = []

    def __call__(self, path: str) -> bytes:
        self.calls.append(path)
        if path in self.files:
            return self.files[path]
        if self.default is None:
            raise repdb.RepdbError("injoignable")
        return self.default


def run(*entries: dict[str, Any], fetch: Fetcher | None = None) -> Any:
    exercises = catalog(*entries)
    import_exercises(exercises=exercises)
    return import_images(exercises=exercises, fetch=fetch or Fetcher(default=picture()))


def serving(body: bytes) -> Any:
    @contextmanager
    def opener(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        yield io.BytesIO(body)

    return opener


# --- Passerelle -------------------------------------------------------------------------------


def test_the_catalog_is_mapped_to_our_categories_and_poses() -> None:
    parsed = catalog(
        entry("press"),
        entry("run", category="cardio", body_part="full_body"),
        entry("hold", body_part="core", images={"flat": {"main": "images/flat/hold-main.webp"}}),
        entry("plank", body_part="full_body"),
    )

    assert [(item.id, item.category) for item in parsed] == [
        ("press", Category.CHEST),
        ("run", Category.CARDIO),  # la catégorie cardio prime sur la partie du corps
        ("hold", Category.ABS),
        ("plank", Category.FULL_BODY),
    ]
    assert [image.pose for image in parsed[0].images] == ["start", "peak"]
    assert [image.pose for image in parsed[2].images] == ["main"]
    assert parsed[0].equipment_codes == ("barbell",)


@pytest.mark.parametrize(
    "overrides",
    [
        {"body_part": "tail"},
        {"name_en": "   "},
        {"id": "../evil"},
    ],
)
def test_unusable_exercises_are_skipped(overrides: dict[str, Any]) -> None:
    assert catalog(entry(**overrides)) == []


@pytest.mark.parametrize(
    "path",
    ["https://evil.example/a.webp", "images/../secret.webp", "images/flat/a.png", "/etc/passwd"],
)
def test_image_paths_outside_the_dataset_are_dropped(path: str) -> None:
    [parsed] = catalog(entry(images={"flat": {"start": path}}))

    assert parsed.images == ()


def test_an_unexpected_catalog_shape_is_an_error() -> None:
    with pytest.raises(repdb.RepdbError):
        repdb.parse_catalog({"items": []})


def test_the_catalog_is_fetched_from_the_configured_source() -> None:
    body = json.dumps({"exercises": [entry()]}).encode()
    requested: list[str] = []

    @contextmanager
    def opener(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        requested.append(request.full_url)
        yield io.BytesIO(body)

    [parsed] = repdb.fetch_catalog(BASE, opener=opener)

    assert parsed.id == "test-press"
    assert requested == [f"{BASE}/exercises.json"]


def test_fetching_is_bounded_and_refuses_anything_unexpected() -> None:
    with pytest.raises(repdb.RepdbError):  # http en clair
        repdb.fetch_catalog("http://repdb.example", opener=serving(b"{}"))
    with pytest.raises(repdb.RepdbError):  # JSON illisible
        repdb.fetch_catalog(BASE, opener=serving(b"<html>"))
    with pytest.raises(repdb.RepdbError):  # image trop lourde
        repdb.fetch_image(
            "images/flat/a.webp",
            base_url=BASE,
            opener=serving(b"x" * (repdb.MAX_IMAGE_BYTES + 1)),
        )
    with pytest.raises(repdb.RepdbError):  # chemin hors du jeu de données
        repdb.fetch_image("https://evil.example/a.webp", base_url=BASE, opener=serving(b"x"))
    assert repdb.fetch_image("images/flat/a.webp", base_url=BASE, opener=serving(b"ok")) == b"ok"


def test_network_failures_become_repdb_errors() -> None:
    @contextmanager
    def down(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        raise URLError("injoignable")
        yield io.BytesIO()

    @contextmanager
    def truncated(request: Any, timeout: int) -> Iterator[Any]:
        class Body:
            def read(self, amt: int) -> bytes:
                raise http.client.IncompleteRead(b"")

        yield Body()

    for opener in (down, truncated):
        with pytest.raises(repdb.RepdbError):
            repdb.fetch_image("images/flat/a.webp", base_url=BASE, opener=opener)


def test_redirections_are_refused() -> None:
    # Le contrôle d'hôte porte sur l'URL demandée : une redirection le contournerait.
    with pytest.raises(repdb.RepdbError):
        repdb._NoRedirect().redirect_request(
            Request("https://repdb.example/main/exercises.json"),
            io.BytesIO(),
            302,
            "Found",
            {},
            "http://169.254.169.254/latest/meta-data/",
        )


# --- Normalisation ----------------------------------------------------------------------------


def test_images_are_reencoded_at_their_native_square_size() -> None:
    normalized = images.normalize(picture((512, 512)))

    with Image.open(io.BytesIO(normalized.content)) as result:
        assert (result.format, result.size) == ("WEBP", (512, 512))
        # Sans marge : le fond de l'illustration va jusqu'au bord.
        assert result.convert("RGB").getpixel((1, 1)) == pytest.approx((200, 220, 240), abs=4)
    assert normalized.digest == hashlib.sha256(normalized.content).hexdigest()


def test_metadata_is_stripped_and_only_web_formats_are_decoded() -> None:
    exif = Image.Exif()
    exif[0x8825] = {2: (48.0, 51.0, 24.0)}  # GPSInfo
    output = io.BytesIO()
    Image.new("RGB", (64, 64)).save(output, format="JPEG", exif=exif)
    with Image.open(io.BytesIO(images.normalize(output.getvalue()).content)) as result:
        assert not result.getexif()

    for fmt in ("TGA", "BMP", "TIFF"):
        with pytest.raises(images.ImageRejectedError):
            images.normalize(picture((20, 20), fmt=fmt))
    with pytest.raises(images.ImageRejectedError):
        images.normalize(b"<svg/>")


def test_oversized_images_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(images, "MAX_PIXELS", 100)

    with pytest.raises(images.ImageRejectedError):
        images.normalize(picture((20, 20)))


# --- Import du catalogue ----------------------------------------------------------------------


def test_the_catalog_is_imported_with_our_french_vocabulary() -> None:
    report = import_exercises(
        exercises=catalog(entry(), entry("odd", primary_muscles=["tongue"], equipment="anvil"))
    )

    assert (report.created, report.updated, report.deactivated) == (2, 0, 0)
    press = Exercise.objects.get(source_id="test-press")
    assert (press.name, press.name_language, press.category) == ("Test Press", "en", "chest")
    assert [muscle.name for muscle in press.muscles.all()] == ["Grand pectoral"]
    assert [item.name for item in press.equipment.all()] == ["Barre"]
    assert press.license_author == "RepDB"
    # Code inconnu : gardé lisible, sans faire échouer l'import.
    assert Muscle.objects.get(code="tongue").name == "tongue"
    assert Equipment.objects.get(code="anvil").name == "anvil"


def test_a_rerun_updates_and_retires_without_duplicates() -> None:
    import_exercises(exercises=catalog(entry(), entry("gone")))

    report = import_exercises(exercises=catalog(entry(name_en="Renamed Press")))

    assert (report.created, report.updated, report.deactivated) == (0, 1, 1)
    assert Exercise.objects.get(source_id="test-press").name == "Renamed Press"
    assert not Exercise.objects.get(source_id="gone").is_active


def test_an_empty_catalog_changes_nothing() -> None:
    import_exercises(exercises=catalog(entry()))

    with pytest.raises(EmptyCatalogError):
        import_exercises(exercises=[])

    assert Exercise.objects.get().is_active


# --- Import des images ------------------------------------------------------------------------


def test_every_pose_is_stored_in_display_order(media_root: Path) -> None:
    report = run(entry())

    assert (report.imported, report.failed) == (2, 0)
    stored = list(ExerciseImage.objects.all())
    assert [image.pose for image in stored] == ["start", "peak"]
    for image in stored:
        assert image.file.name == f"exercises/{image.digest}.webp"
        assert (media_root / image.file.name).exists()


def test_a_rerun_downloads_nothing_new() -> None:
    fetch = Fetcher(default=picture())
    run(entry(), fetch=fetch)

    report = run(entry(), fetch=fetch)

    assert (report.imported, report.unchanged) == (0, 2)
    assert len(fetch.calls) == 2


def test_a_new_format_version_redoes_the_images(monkeypatch: pytest.MonkeyPatch) -> None:
    run(entry())

    monkeypatch.setattr(services, "FORMAT_VERSION", images.FORMAT_VERSION + 1)
    report = run(entry())

    assert report.imported == 2


def test_dropped_poses_are_removed_with_their_file(media_root: Path) -> None:
    # Deux positions différentes : deux fichiers (une image identique partagerait le sien).
    run(
        entry(),
        fetch=Fetcher({"images/flat/test-press-peak.webp": picture((300, 300))}, default=picture()),
    )
    peak = ExerciseImage.objects.get(pose="peak")
    name = peak.file.name or ""

    single = {"flat": {"start": "images/flat/test-press-start.webp"}}
    report = run(entry(images=single))

    assert report.removed == 1
    assert not ExerciseImage.objects.filter(pose="peak").exists()
    assert not (media_root / name).exists()


def test_one_failing_image_does_not_stop_the_others() -> None:
    fetch = Fetcher({"images/flat/test-press-peak.webp": picture()})

    report = run(entry(), fetch=fetch)

    assert (report.imported, report.failed) == (1, 1)
    assert [image.pose for image in ExerciseImage.objects.all()] == ["peak"]


def test_a_damaged_or_missing_file_is_written_again(media_root: Path) -> None:
    run(entry())
    image = ExerciseImage.objects.get(pose="start")
    stored = media_root / (image.file.name or "")

    stored.unlink()
    run(entry())
    assert stored.exists()

    stored.write_bytes(b"RIFF tronque")
    ExerciseImage.objects.update(format_version=0)
    run(entry())
    assert hashlib.sha256(stored.read_bytes()).hexdigest() == image.digest


def test_images_of_an_exercise_not_in_the_catalog_are_ignored() -> None:
    fetch = Fetcher(default=picture())

    report = import_images(exercises=catalog(entry()), fetch=fetch)

    assert report.imported == 0
    assert fetch.calls == []


# --- API --------------------------------------------------------------------------------------


def test_the_start_pose_illustrates_the_exercise_and_the_sheet_has_both() -> None:
    run(entry())
    athlete = Athlete()

    [item] = athlete.get("/exercises/").json()["items"]
    sheet = athlete.get(f"/exercises/{item['id']}/").json()

    start, peak = ExerciseImage.objects.all()
    assert item["image"]["url"] == f"/api/v1/exercise-images/{start.digest}.webp"
    assert [image["url"] for image in sheet["images"]] == [
        f"/api/v1/exercise-images/{start.digest}.webp",
        f"/api/v1/exercise-images/{peak.digest}.webp",
    ]
    assert sheet["images"][0]["license_author"] == "RepDB"


def test_images_are_served_with_a_long_immutable_cache() -> None:
    run(entry())
    digest = ExerciseImage.objects.first().digest  # type: ignore[union-attr]

    response = Client().get(f"{API}/exercise-images/{digest}.webp")

    assert response.status_code == 200
    assert response["Content-Type"] == "image/webp"
    assert response["Cache-Control"] == "public, max-age=31536000, immutable"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert b"".join(response.streaming_content)[:4] == b"RIFF"  # type: ignore[attr-defined]
    response.close()


@pytest.mark.parametrize(
    "name", ["0" * 64 + ".webp", "../../config/settings.py", "A" * 64 + ".webp"]
)
def test_only_known_digests_are_served(name: str) -> None:
    assert Client().get(f"{API}/exercise-images/{name}").status_code == 404


def test_a_workout_line_carries_its_exercise_image() -> None:
    run(entry())
    athlete = Athlete()
    [item] = athlete.get("/exercises/").json()["items"]
    workout_id, line_id = uuid4(), uuid4()
    athlete.put(f"/workouts/{workout_id}/", {"started_at": STARTED})
    athlete.put(
        f"/workout-exercises/{line_id}/",
        {"workout_id": str(workout_id), "exercise_id": item["id"], "position": 0},
    )

    [line] = athlete.get(f"/workouts/{workout_id}/").json()["exercises"]

    assert line["exercise_image"] == item["image"]


# --- Commande et tâche ------------------------------------------------------------------------


def test_the_command_imports_a_local_file_without_images(tmp_path: Path) -> None:
    source = tmp_path / "exercises.json"
    source.write_text(json.dumps({"exercises": [entry()]}), encoding="utf-8")
    out = io.StringIO()

    call_command("import_exercises", file=source, stdout=out)

    assert "1 créés" in out.getvalue()
    assert not ExerciseImage.objects.exists()


def test_the_command_fetches_catalog_and_images() -> None:
    out = io.StringIO()
    with (
        mock.patch.object(repdb, "fetch_catalog", return_value=catalog(entry())),
        mock.patch.object(repdb, "fetch_image", return_value=picture()),
    ):
        call_command("import_exercises", stdout=out)

    assert "Images : 2 importées" in out.getvalue()


def test_the_command_leaves_the_catalog_untouched_on_failure(tmp_path: Path) -> None:
    source = tmp_path / "exercises.json"
    source.write_text("{}", encoding="utf-8")

    with pytest.raises(CommandError, match="catalogue inchangé"):
        call_command("import_exercises", file=source)


def test_the_monthly_task_imports_catalog_then_images() -> None:
    with (
        mock.patch.object(repdb, "fetch_catalog", return_value=catalog(entry())) as fetched,
        mock.patch.object(repdb, "fetch_image", return_value=picture()),
    ):
        import_task()

    fetched.assert_called_once_with(settings.REPDB_BASE_URL)
    assert ExerciseImage.objects.count() == 2
    schedule = settings.CELERY_BEAT_SCHEDULE["import-exercises"]
    assert schedule["task"] == "apps.training.tasks.import_exercises"
    assert schedule["schedule"] == crontab(day_of_month="1", hour="3", minute="30")


def test_only_one_import_runs_at_a_time(tmp_path: Path) -> None:
    source = tmp_path / "exercises.json"
    source.write_text(json.dumps({"exercises": [entry()]}), encoding="utf-8")

    with services.import_lock():
        with pytest.raises(CommandError, match="déjà en cours"):
            call_command("import_exercises", file=source)
        with mock.patch.object(repdb, "fetch_catalog") as fetched:
            import_task()  # la tâche passe son tour, sans erreur
        fetched.assert_not_called()

    call_command("import_exercises", file=source, stdout=io.StringIO())  # verrou rendu
    assert Exercise.objects.count() == 1


def test_an_expired_lock_held_by_another_run_is_left_alone() -> None:
    from django.core.cache import cache

    with services.import_lock():
        cache.set(services.IMPORT_LOCK, "autre-import")  # le nôtre a expiré, repris ailleurs

    assert cache.get(services.IMPORT_LOCK) == "autre-import"
    cache.delete(services.IMPORT_LOCK)
