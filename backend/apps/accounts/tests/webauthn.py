"""Authentificateur WebAuthn logiciel pour les tests : clé ES256, attestation `none`.

Il produit de vraies réponses signées, vérifiées par fido2 comme celles d'un navigateur : les
tests exercent la cryptographie d'allauth, rien n'est simulé côté serveur.
"""

import json
import secrets
from hashlib import sha256
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fido2 import cbor
from fido2.utils import websafe_encode

ORIGIN = "http://localhost:3000"  # FRONTEND_URL des réglages de test

# Indicateurs des données d'authentificateur : présence (UP), vérification (UV), données
# d'identifiant attestées (AT).
UP, UV, AT = 0x01, 0x04, 0x40


class SoftAuthenticator:
    """Une passkey : un identifiant, une clé privée et l'identifiant utilisateur reçu."""

    def __init__(
        self, origin: str = ORIGIN, *, resident: bool | None = True, verifies_user: bool = True
    ) -> None:
        self.origin = origin
        # Clé résidente (passkey) ou simple clé de second facteur ; vérification PIN/biométrie.
        self.resident = resident
        self.verifies_user = verifies_user
        self.credential_id = secrets.token_bytes(16)
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.user_handle = ""
        self.rp_id = ""
        self.counter = 0

    def _client_data(self, kind: str, challenge: str) -> bytes:
        data = {"type": kind, "challenge": challenge, "origin": self.origin, "crossOrigin": False}
        return json.dumps(data).encode()

    def create(self, creation_options: dict[str, Any]) -> dict[str, Any]:
        """Réponse à `navigator.credentials.create()` pour les options d'allauth."""
        options = creation_options["publicKey"]
        self.rp_id = options["rp"]["id"]
        self.user_handle = options["user"]["id"]
        numbers = self.private_key.public_key().public_numbers()
        # Clé COSE EC2 (RFC 9053) : kty=EC2, alg=ES256, crv=P-256, coordonnées x et y.
        cose_key = cbor.encode(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )
        attested = (
            bytes(16)  # AAGUID nul : authentificateur sans attestation
            + len(self.credential_id).to_bytes(2, "big")
            + self.credential_id
            + cose_key
        )
        auth_data = (
            sha256(self.rp_id.encode()).digest()
            + bytes([UP | UV | AT])
            + self.counter.to_bytes(4, "big")
            + attested
        )
        attestation = cbor.encode({"fmt": "none", "attStmt": {}, "authData": auth_data})
        client_data = self._client_data("webauthn.create", options["challenge"])
        return {
            "id": websafe_encode(self.credential_id),
            "rawId": websafe_encode(self.credential_id),
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": (
                {} if self.resident is None else {"credProps": {"rk": self.resident}}
            ),
            "response": {
                "clientDataJSON": websafe_encode(client_data),
                "attestationObject": websafe_encode(attestation),
                "transports": ["internal"],
            },
        }

    def get(self, request_options: dict[str, Any], origin: str | None = None) -> dict[str, Any]:
        """Réponse à `navigator.credentials.get()` : assertion signée par la clé privée."""
        options = request_options["publicKey"]
        self.counter += 1
        auth_data = (
            sha256(self.rp_id.encode()).digest()
            + bytes([UP | UV if self.verifies_user else UP])
            + self.counter.to_bytes(4, "big")
        )
        client_data = json.dumps(
            {
                "type": "webauthn.get",
                "challenge": options["challenge"],
                "origin": origin or self.origin,
                "crossOrigin": False,
            }
        ).encode()
        signature = self.private_key.sign(
            auth_data + sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": websafe_encode(self.credential_id),
            "rawId": websafe_encode(self.credential_id),
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
            "response": {
                "clientDataJSON": websafe_encode(client_data),
                "authenticatorData": websafe_encode(auth_data),
                "signature": websafe_encode(signature),
                "userHandle": self.user_handle,
            },
        }
