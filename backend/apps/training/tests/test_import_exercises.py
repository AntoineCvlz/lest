"""Import du catalogue wger (ADR 0004) : passerelle, service, commande et tâche."""

import io
import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.error import URLError
from uuid import UUID

import pytest
from celery.schedules import crontab
from django.conf import settings
from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction

from apps.training import wger
from apps.training.models import Category, Equipment, Exercise, Muscle, NameLanguage
from apps.training.services import EmptyCatalogError, import_wger_exercises
from apps.training.tasks import import_exercises

pytestmark = pytest.mark.django_db

FIXTURE = Path(__file__).parent / "fixtures" / "wger_exerciseinfo.json"
PAGES: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))
BENCH = UUID("11111111-1111-4111-8111-111111111111")
HIP_THRUST = UUID("22222222-2222-4222-8222-222222222222")
PLANK = UUID("33333333-3333-4333-8333-333333333333")
BASE = "https://wger.example/api/v2"


def fixture_exercises() -> list[wger.WgerExercise]:
    return [exercise for page in PAGES for exercise in wger.parse_page(page)[0]]


def fake_opener(pages: dict[str, object]) -> Any:
    """Opener factice : URL → corps JSON ; une URL inconnue est une erreur réseau."""

    @contextmanager
    def opener(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        if request.full_url not in pages:
            raise URLError("injoignable")
        yield io.BytesIO(json.dumps(pages[request.full_url]).encode())

    return opener


# --- Passerelle -----------------------------------------------------------------------------


def test_a_page_gives_french_names_with_an_english_fallback() -> None:
    exercises, next_url = wger.parse_page(PAGES[0])

    assert next_url == "https://wger.de/api/v2/exerciseinfo/?limit=100&offset=3"
    bench, hip_thrust, plank = exercises
    assert (bench.name_fr, bench.name_en) == ("Développé couché", "Bench press")
    assert (hip_thrust.name_fr, hip_thrust.name_en) == (None, "Hip thrust")
    assert plank.license_author == ""  # absent chez wger
    assert bench.muscle_ids == (4,)
    assert bench.equipment_ids == (1, 8)


def test_a_blank_translation_is_no_name() -> None:
    exercises, _ = wger.parse_page(PAGES[1])

    assert exercises[1].name_fr is None


@pytest.mark.parametrize("payload", [{}, {"results": [{"uuid": "pas-un-uuid"}]}, [], None])
def test_an_unexpected_page_is_refused(payload: object) -> None:
    with pytest.raises(wger.WgerError):
        wger.parse_page(payload)


def test_every_page_is_fetched() -> None:
    first = dict(PAGES[0], next=f"{BASE}/exerciseinfo/?limit=100&offset=3")
    opener = fake_opener(
        {
            f"{BASE}/exerciseinfo/?limit=100": first,
            f"{BASE}/exerciseinfo/?limit=100&offset=3": PAGES[1],
        }
    )

    exercises = wger.fetch_exercises(BASE, opener=opener)

    assert len(exercises) == 5


def test_a_next_page_on_another_server_is_refused() -> None:
    opener = fake_opener({f"{BASE}/exerciseinfo/?limit=100": PAGES[0]})  # next : wger.de

    with pytest.raises(wger.WgerError, match="hors du serveur"):
        wger.fetch_exercises(BASE, opener=opener)


def test_an_oversized_page_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wger, "MAX_PAGE_BYTES", 10)

    with pytest.raises(wger.WgerError, match="trop volumineuse"):
        wger.fetch_exercises(
            BASE, opener=fake_opener({f"{BASE}/exerciseinfo/?limit=100": PAGES[1]})
        )


def test_an_unreadable_page_is_an_import_error() -> None:
    @contextmanager
    def opener(request: Any, timeout: int) -> Iterator[io.BytesIO]:
        yield io.BytesIO(b"<html>maintenance</html>")

    with pytest.raises(wger.WgerError, match="illisible"):
        wger.fetch_exercises(BASE, opener=opener)


def test_an_unreachable_wger_is_an_import_error() -> None:
    with pytest.raises(wger.WgerError):
        wger.fetch_exercises(BASE, opener=fake_opener({}))


# --- Service --------------------------------------------------------------------------------


def test_the_import_builds_the_catalog_in_french() -> None:
    report = import_wger_exercises(exercises=fixture_exercises())

    assert (report.created, report.updated, report.skipped) == (3, 0, 2)
    bench = Exercise.objects.get(wger_uuid=BENCH)
    assert (bench.name, bench.name_language, bench.category) == (
        "Développé couché",
        NameLanguage.FRENCH,
        Category.CHEST,
    )
    assert [m.name for m in bench.muscles.all()] == ["Grand pectoral"]
    assert sorted(m.name for m in bench.secondary_muscles.all()) == [
        "Deltoïde antérieur",
        "Triceps",
    ]
    assert sorted(e.name for e in bench.equipment.all()) == ["Banc", "Barre"]
    assert (bench.license, bench.license_author) == ("CC-BY-SA 4", "auteur-wger-1")
    hip_thrust = Exercise.objects.get(wger_uuid=HIP_THRUST)
    assert (hip_thrust.name, hip_thrust.name_language) == ("Hip thrust", NameLanguage.ENGLISH)


def test_unaccepted_licenses_and_unnamed_exercises_are_skipped() -> None:
    import_wger_exercises(exercises=fixture_exercises())

    assert set(Exercise.objects.values_list("wger_uuid", flat=True)) == {BENCH, HIP_THRUST, PLANK}


def test_the_import_can_be_replayed_without_duplicates() -> None:
    import_wger_exercises(exercises=fixture_exercises())

    report = import_wger_exercises(exercises=fixture_exercises())

    assert (report.created, report.updated) == (0, 3)
    assert Exercise.objects.count() == 3
    assert Muscle.objects.count() == len(wger.MUSCLES)
    assert Equipment.objects.count() == len(wger.EQUIPMENT)


def test_a_new_translation_replaces_the_english_name() -> None:
    import_wger_exercises(exercises=fixture_exercises())
    translated = [
        wger.WgerExercise(**{**vars(item), "name_fr": "Poussée de hanches"})
        if item.uuid == HIP_THRUST
        else item
        for item in fixture_exercises()
    ]

    import_wger_exercises(exercises=translated)

    hip_thrust = Exercise.objects.get(wger_uuid=HIP_THRUST)
    assert (hip_thrust.name, hip_thrust.name_language) == (
        "Poussée de hanches",
        NameLanguage.FRENCH,
    )


def test_an_exercise_removed_by_wger_is_kept_but_deactivated() -> None:
    import_wger_exercises(exercises=fixture_exercises())

    report = import_wger_exercises(
        exercises=[item for item in fixture_exercises() if item.uuid != PLANK]
    )

    assert report.deactivated == 1
    plank = Exercise.objects.get(wger_uuid=PLANK)
    assert not plank.is_active

    import_wger_exercises(exercises=fixture_exercises())  # revenu chez wger
    plank.refresh_from_db()
    assert plank.is_active


def test_an_empty_catalog_changes_nothing() -> None:
    import_wger_exercises(exercises=fixture_exercises())

    with pytest.raises(EmptyCatalogError):
        import_wger_exercises(exercises=[])

    assert Exercise.objects.filter(is_active=True).count() == 3


def test_the_database_refuses_an_unknown_category() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Exercise.objects.create(
            name="Inconnu", name_language=NameLanguage.FRENCH, category="yoga", license="CC0"
        )


# --- Commande et tâche ----------------------------------------------------------------------


def test_the_command_imports_recorded_pages_without_network() -> None:
    out = io.StringIO()

    call_command("import_exercises", file=FIXTURE, stdout=out)

    assert "3 créés" in out.getvalue()
    assert Exercise.objects.count() == 3


def test_the_command_fails_visibly_and_leaves_the_catalog_unchanged() -> None:
    import_wger_exercises(exercises=fixture_exercises())

    with (
        mock.patch.object(wger, "fetch_exercises", side_effect=wger.WgerError("panne")),
        pytest.raises(CommandError, match="catalogue inchangé"),
    ):
        call_command("import_exercises")

    assert Exercise.objects.filter(is_active=True).count() == 3


def test_the_monthly_task_imports_from_the_configured_server() -> None:
    with mock.patch.object(wger, "fetch_exercises", return_value=fixture_exercises()) as fetch:
        import_exercises.delay().get(timeout=1)

    fetch.assert_called_once_with(settings.WGER_API_URL)
    assert Exercise.objects.count() == 3


def test_the_import_runs_monthly() -> None:
    entry = settings.CELERY_BEAT_SCHEDULE["import-exercises"]

    assert entry["task"] == import_exercises.name
    assert entry["schedule"] == crontab(day_of_month=1, hour=3, minute=30)
