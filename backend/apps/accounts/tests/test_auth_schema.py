"""Contrat front/back des routes d'authentification (allauth), comme `openapi.json` pour Ninja.

Le client d'authentification du front est typé depuis `auth-openapi.json`, la spécification
qu'allauth produit pour nos réglages. Pour la régénérer : `just typegen`.
"""

import json
from pathlib import Path

from apps.accounts.auth_schema import auth_schema

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "auth-openapi.json"


def test_committed_auth_schema_matches_allauth() -> None:
    committed = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    assert committed == auth_schema(), "auth-openapi.json est obsolète : lancer `just typegen`"


def test_schema_is_pinned_to_the_app_client_under_the_api_prefix() -> None:
    paths = auth_schema()["paths"]

    assert "/api/v1/auth/app/v1/auth/login" in paths
    assert all(path.startswith("/api/v1/auth/app/v1/") for path in paths)


def test_webauthn_credential_is_an_open_object() -> None:
    # Le front envoie le JSON du navigateur tel quel : il doit rester typable.
    credential = auth_schema()["components"]["schemas"]["WebAuthnCredential"]

    assert credential["type"] == "object"
    assert credential["additionalProperties"] is True
