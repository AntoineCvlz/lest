"""Spécification OpenAPI des routes d'allauth, telle qu'allauth la calcule pour nos réglages."""

import json
from typing import Any
from unittest import mock

from allauth.headless.spec.internal import schema as allauth_schema

# Préfixe de montage d'allauth (`config/urls.py`). allauth le déduit de la route qui sert la
# spécification, que nous n'exposons pas (`HEADLESS_SERVE_SPECIFICATION` reste désactivé) :
# on lui fournit donc directement. Version d'allauth épinglée, à revérifier à chaque montée.
AUTH_SPEC_URL = "/api/v1/auth/openapi.yaml"
# allauth illustre l'identifiant (UUID) par un `uuid4()` tiré à chaque appel : fixé ici pour
# que la spécification soit reproductible (contrat vérifié par les tests).
EXAMPLE_USER_ID = "00000000-0000-4000-8000-000000000000"
# Exemples de jetons de la documentation d'allauth : remplacés par des valeurs manifestement
# factices, pour qu'aucune chaîne à l'allure de secret n'entre dans le dépôt (Gitleaks).
TOKEN_KEYS = ("access_token", "refresh_token", "session_token")


def _placeholder_tokens(node: Any) -> Any:
    if isinstance(node, dict):
        return {
            key: f"<{key}>"
            if key in TOKEN_KEYS and isinstance(value, str)
            else _placeholder_tokens(value)
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [_placeholder_tokens(item) for item in node]
    return node


def auth_schema() -> dict[str, Any]:
    """Client `app` seul, routes non activées retirées, chemins sous `/api/v1/auth/`.

    Repassé par JSON pour obtenir des types JSON purs, sans la longue description : elle
    n'apporte rien aux types générés.
    """
    with mock.patch.object(allauth_schema, "reverse", return_value=AUTH_SPEC_URL):
        raw = allauth_schema.get_schema()
    # L'exemple est recopié dans plusieurs réponses : on remplace la valeur partout.
    random_id = str(raw["components"]["examples"]["User"]["value"]["id"])
    text = json.dumps(raw, default=str).replace(f'"{random_id}"', f'"{EXAMPLE_USER_ID}"')
    schema: dict[str, Any] = _placeholder_tokens(json.loads(text))
    schema["info"].pop("description", None)
    return schema
