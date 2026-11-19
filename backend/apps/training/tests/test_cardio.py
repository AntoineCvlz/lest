"""Exercices de cardio de Lest (ADR 0017) : écrits par la migration, jamais retirés par
l'import RepDB, visibles de tous."""

import pytest

from apps.training.cardio import CARDIO_EXERCISES, LEST_PREFIX
from apps.training.models import Exercise
from apps.training.services import import_exercises
from apps.training.tests.test_repdb import catalog, entry
from apps.training.tests.test_workouts_api import Athlete

pytestmark = pytest.mark.django_db


def test_the_lest_cardio_exercises_are_never_retired_by_the_import() -> None:
    import_exercises(exercises=catalog(entry()))

    lest = Exercise.objects.filter(source_id__startswith=LEST_PREFIX)
    assert lest.count() == len(CARDIO_EXERCISES)
    assert all(exercise.is_active and exercise.owner_id is None for exercise in lest)
    assert set(lest.values_list("kind", flat=True)) == {"distance_duration", "duration"}


def test_every_account_finds_them_in_the_catalog() -> None:
    body = Athlete().get("/exercises/?q=course").json()

    assert [(item["name"], item["kind"]) for item in body["items"]] == [
        ("Course à pied", "distance_duration")
    ]
