"""Objectifs nutritionnels proposés (ADR 0011) : calcul pur, sans base de données.

Métabolisme de base de Mifflin-St Jeor, multiplié par le niveau d'activité, ajusté selon
l'objectif du profil (prise de masse, maintien, sèche). Protéines et lipides sont fixés par
kilo de poids de corps, les glucides complètent l'énergie.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

# Facteurs d'activité usuels (Mifflin-St Jeor), du bureau au travail physique quotidien.
ACTIVITY_FACTORS: Final = {
    "sedentary": Decimal("1.2"),
    "light": Decimal("1.375"),
    "moderate": Decimal("1.55"),
    "active": Decimal("1.725"),
    "very_active": Decimal("1.9"),
}
# Ajustement de l'énergie selon l'objectif du profil (`accounts.Goal`).
GOAL_FACTORS: Final = {"gain": Decimal("1.10"), "maintain": Decimal(1), "cut": Decimal("0.80")}
PROTEIN_G_PER_KG: Final = Decimal(2)
FAT_G_PER_KG: Final = Decimal("0.9")
KCAL_PER_G: Final = {"protein": 4, "carbs": 4, "fat": 9}
# Constante de la formule selon le sexe retenu pour le calcul.
SEX_OFFSET: Final = {"male": Decimal(5), "female": Decimal(-161)}


@dataclass(frozen=True)
class Inputs:
    sex: str
    birth_date: date
    activity: str
    weight_kg: Decimal
    height_m: Decimal
    goal: str


@dataclass(frozen=True)
class Targets:
    kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int


def _round(value: Decimal, step: int = 1) -> int:
    return int((value / step).quantize(Decimal(1), rounding=ROUND_HALF_UP) * step)


def age(birth_date: date, today: date) -> int:
    """Âge en années révolues."""
    before_birthday = (today.month, today.day) < (birth_date.month, birth_date.day)
    return today.year - birth_date.year - int(before_birthday)


def basal_kcal(inputs: Inputs, *, today: date) -> Decimal:
    """Métabolisme de base, Mifflin-St Jeor : 10 x kg + 6,25 x cm - 5 x âge + constante."""
    return (
        10 * inputs.weight_kg
        + Decimal("6.25") * inputs.height_m * 100
        - 5 * age(inputs.birth_date, today)
        + SEX_OFFSET[inputs.sex]
    )


def compute(inputs: Inputs, *, today: date) -> Targets:
    """Objectifs du jour : énergie arrondie à 10 kcal, macros au gramme, glucides jamais
    négatifs."""
    kcal = _round(
        basal_kcal(inputs, today=today)
        * ACTIVITY_FACTORS[inputs.activity]
        * GOAL_FACTORS[inputs.goal],
        step=10,
    )
    protein = _round(PROTEIN_G_PER_KG * inputs.weight_kg)
    fat = _round(FAT_G_PER_KG * inputs.weight_kg)
    rest = kcal - protein * KCAL_PER_G["protein"] - fat * KCAL_PER_G["fat"]
    carbs = max(0, _round(Decimal(rest) / KCAL_PER_G["carbs"]))
    return Targets(kcal=kcal, protein_g=protein, carbs_g=carbs, fat_g=fat)
