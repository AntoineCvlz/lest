"""Catalogue d'exercices : recherche, filtres, pagination par curseur, fiche et attribution."""

from typing import Any, get_args
from uuid import uuid4

import pytest
from django.test import Client

from apps.training.api.router import CategoryName
from apps.training.models import Category, Equipment, Muscle, NameLanguage
from apps.training.tests.factories import make_exercise
from apps.training.tests.test_workouts_api import API, Athlete

pytestmark = pytest.mark.django_db


@pytest.fixture
def athlete() -> Athlete:
    return Athlete()


def names(response: Any) -> list[str]:
    assert response.status_code == 200
    return [item["name"] for item in response.json()["items"]]


def test_the_catalog_requires_an_account() -> None:
    assert Client().get(f"{API}/exercises/").status_code == 401


def test_exercises_are_listed_alphabetically_without_retired_ones(athlete: Athlete) -> None:
    make_exercise(name="Squat")
    make_exercise(name="Développé couché")
    make_exercise(name="Rowing", is_active=False)

    assert names(athlete.get("/exercises/")) == ["Développé couché", "Squat"]


def test_search_ignores_accents_case_and_word_order(athlete: Athlete) -> None:
    make_exercise(name="Développé couché haltères")
    make_exercise(name="Développé militaire")

    assert names(athlete.get("/exercises/?q=COUCHE developpe")) == ["Développé couché haltères"]


def test_filters_by_category_muscle_and_equipment(athlete: Athlete) -> None:
    biceps = Muscle.objects.create(wger_id=1, name="Biceps brachii", is_front=True)
    dumbbell = Equipment.objects.create(wger_id=3, name="Dumbbell")
    curl = make_exercise(name="Curl", category=Category.ARMS)
    curl.muscles.add(biceps)
    curl.equipment.add(dumbbell)
    row = make_exercise(name="Rowing", category=Category.BACK)
    row.secondary_muscles.add(biceps)
    make_exercise(name="Squat", category=Category.LEGS)

    assert names(athlete.get("/exercises/?category=arms")) == ["Curl"]
    assert names(athlete.get(f"/exercises/?muscle={biceps.pk}")) == ["Curl", "Rowing"]
    assert names(athlete.get(f"/exercises/?equipment={dumbbell.pk}")) == ["Curl"]
    assert names(athlete.get(f"/exercises/?muscle={biceps.pk}&category=back")) == ["Rowing"]


def test_the_cursor_walks_every_page_once(athlete: Athlete) -> None:
    # Noms identiques : l'identifiant départage, aucune ligne sautée ni répétée.
    for name in ("A", "B", "B", "B", "C"):
        make_exercise(name=name)
    seen: list[str] = []
    path = "/exercises/?limit=2"
    while True:
        body = athlete.get(path).json()
        seen += [item["id"] for item in body["items"]]
        if body["next_cursor"] is None:
            break
        path = f"/exercises/?limit=2&cursor={body['next_cursor']}"

    assert len(seen) == len(set(seen)) == 5


@pytest.mark.parametrize("cursor", ["%%%", "bm9u", "WyJhIiwiYiJd", "x" * 3000])
def test_a_tampered_cursor_is_refused(athlete: Athlete, cursor: str) -> None:
    # Illisible, mauvais format, UUID invalide (["a","b"]), trop long.
    response = athlete.get(f"/exercises/?cursor={cursor}")

    assert response.status_code == 422
    assert response.json()["type"] == "urn:lest:problem:invalid-cursor"


@pytest.mark.parametrize(
    "query", ["limit=0", "limit=101", "muscle=0", "category=neck", f"q={'a' * 101}"]
)
def test_out_of_range_parameters_are_refused(athlete: Athlete, query: str) -> None:
    assert athlete.get(f"/exercises/?{query}").status_code == 422


def test_the_exercise_sheet_carries_its_attribution(athlete: Athlete) -> None:
    exercise = make_exercise(
        name="Bench press",
        name_language=NameLanguage.ENGLISH,
        license="CC-BY-SA 4",
        license_author="wger contributors",
        is_active=False,  # retiré : toujours lisible depuis l'historique
    )

    body = athlete.get(f"/exercises/{exercise.pk}/").json()

    assert body | {"id": None} == {
        "id": None,
        "name": "Bench press",
        "name_language": "en",
        "category": "chest",
        "muscles": [],
        "secondary_muscles": [],
        "equipment": [],
        "license": "CC-BY-SA 4",
        "license_author": "wger contributors",
        "is_active": False,
        "image": None,  # sans image : pictogramme de la catégorie (ADR 0005)
        "images": [],
    }


def test_an_unknown_exercise_is_not_found(athlete: Athlete) -> None:
    assert athlete.get(f"/exercises/{uuid4()}/").status_code == 404


def test_filters_list_only_values_used_by_active_exercises(athlete: Athlete) -> None:
    used = Muscle.objects.create(wger_id=1, name="Biceps brachii", is_front=True)
    secondary = Muscle.objects.create(wger_id=2, name="Brachialis", is_front=True)
    retired = Muscle.objects.create(wger_id=3, name="Soleus", is_front=False)
    Muscle.objects.create(wger_id=4, name="Unused", is_front=False)
    bar = Equipment.objects.create(wger_id=1, name="Barbell")
    curl = make_exercise(name="Curl")
    curl.muscles.add(used)
    curl.secondary_muscles.add(secondary, used)
    curl.equipment.add(bar)
    make_exercise(name="Old", is_active=False).muscles.add(retired)

    body = athlete.get("/exercise-filters/").json()

    assert body["categories"] == list(Category.values)
    assert [m["name"] for m in body["muscles"]] == ["Biceps brachii", "Brachialis"]
    assert body["equipment"] == [{"id": bar.pk, "name": "Barbell"}]


def test_the_openapi_category_enum_matches_the_model() -> None:
    assert list(get_args(CategoryName)) == list(Category.values)
