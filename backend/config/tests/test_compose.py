"""La stack de dev partage un seul jeu de clés générées entre api et worker (ADR 0002)."""

from pathlib import Path
from typing import Any

import pytest
import yaml

COMPOSE = Path(__file__).resolve().parents[3] / "compose.yaml"

# Exécuté en CI (dépôt complet) ; absent du conteneur de dev, qui ne contient que backend/.
pytestmark = pytest.mark.skipif(not COMPOSE.exists(), reason="compose.yaml hors de portée")


@pytest.mark.parametrize("service", ["api", "worker"])
def test_backend_services_share_the_persistent_dev_keys_volume(service: str) -> None:
    compose: dict[str, Any] = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    config = compose["services"][service]
    keys_dir = config["environment"]["DEV_KEYS_DIR"]

    assert f"devkeys:{keys_dir}" in config["volumes"]
    assert "devkeys" in compose["volumes"]
