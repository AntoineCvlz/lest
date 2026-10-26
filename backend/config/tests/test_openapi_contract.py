"""Contrat front/back : le schéma commité doit être exactement celui que génère l'API.

Le client TypeScript est généré depuis `backend/openapi.json` ; un écart signifie que le
front compile contre une API qui n'existe plus. Pour corriger : `just typegen`.
"""

import json
from pathlib import Path

from ninja.responses import NinjaJSONEncoder

from config.api import api

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def test_committed_openapi_schema_matches_the_api() -> None:
    generated = json.loads(json.dumps(api.get_openapi_schema(), cls=NinjaJSONEncoder))
    committed = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    assert committed == generated, "openapi.json est obsolète : lancer `just typegen`"
