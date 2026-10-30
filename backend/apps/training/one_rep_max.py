"""1RM estimé : charge maximale sur une répétition, déduite d'une série (formule du profil).

Les deux formules divergent et perdent leur fiabilité sur les séries longues : pas
d'estimation au-delà de leur plage (Epley 12 répétitions, Brzycki 10).
"""

from decimal import ROUND_HALF_UP, Decimal

EPLEY, BRZYCKI = "epley", "brzycki"
MAX_REPS = {EPLEY: 12, BRZYCKI: 10}
CENTS = Decimal("0.01")


def estimate_one_rep_max(weight_kg: Decimal, reps: int, formula: str) -> Decimal | None:
    """1RM estimé en kg (arrondi au centième), ou `None` hors de la plage de la formule."""
    if weight_kg <= 0 or not 1 <= reps <= MAX_REPS[formula]:
        return None
    if reps == 1:
        return weight_kg.quantize(CENTS)
    if formula == EPLEY:
        estimate = weight_kg * (1 + Decimal(reps) / 30)
    else:
        estimate = weight_kg * 36 / (37 - Decimal(reps))
    return estimate.quantize(CENTS, rounding=ROUND_HALF_UP)
