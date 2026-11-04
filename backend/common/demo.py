"""Outils des données de démonstration (dev seulement), partagés par les seeds des domaines."""

import hashlib
from uuid import UUID


def stable_id(*parts: object) -> UUID:
    """Identifiant stable, au format v4 : l'API n'accepte que celui-là en retour (ADR 0003),
    l'app peut donc modifier les données de démo comme les autres."""
    digest = hashlib.sha256("/".join(("lest-demo", *map(str, parts))).encode()).digest()
    return UUID(bytes=digest[:16], version=4)


def draw(*parts: object) -> float:
    """Tirage déterministe dans [0, 1) : même entrée, même valeur, d'un seed à l'autre."""
    return stable_id("tirage", *parts).int / 2**128
