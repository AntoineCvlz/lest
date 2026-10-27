import pytest
from django.core.cache import cache


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    # Le cache local survit d'un test à l'autre : les compteurs de limitation de débit
    # d'allauth fuiraient sinon entre les tests.
    cache.clear()
