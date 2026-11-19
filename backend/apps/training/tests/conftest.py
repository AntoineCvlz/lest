import pytest

from apps.training.cardio import LEST_PREFIX
from apps.training.models import Exercise


@pytest.fixture
def empty_catalog() -> None:
    """Catalogue sans les exercices de cardio de Lest (écrits par la migration 0006) : pour les
    tests qui comptent ou parcourent tout le catalogue."""
    Exercise.objects.filter(source_id__startswith=LEST_PREFIX).delete()
