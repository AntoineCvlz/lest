"""Journal alimentaire de démonstration (dev seulement) : deux semaines de prise de masse.

Les repas reposent sur des aliments perso du compte démo, aux valeurs moyennes usuelles :
le seed ne dépend pas de la base Ciqual et n'en recopie rien (ADR 0009). Plan déterministe :
mêmes identifiants (ADR 0003), donc relancer le seed remplace au lieu de dupliquer.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from apps.nutrition.models import Meal
from common.demo import draw, stable_id

DAYS = 14
# Variation des quantités d'un jour à l'autre : ± 15 %.
SPREAD = 0.3
SKIPPED_SNACK = 0.15


@dataclass(frozen=True)
class DemoFood:
    key: str
    name: str
    kcal_100g: Decimal
    protein_100g: Decimal
    carbs_100g: Decimal
    fat_100g: Decimal
    serving_g: Decimal | None

    @property
    def id(self) -> UUID:
        return stable_id("aliment", self.key)


def _food(key: str, name: str, values: str, serving: str | None = None) -> DemoFood:
    kcal, protein, carbs, fat = (Decimal(v) for v in values.split())
    return DemoFood(
        key=key,
        name=name,
        kcal_100g=kcal,
        protein_100g=protein,
        carbs_100g=carbs,
        fat_100g=fat,
        serving_g=Decimal(serving) if serving else None,
    )


# kcal, protéines, glucides, lipides pour 100 g.
FOODS = {
    food.key: food
    for food in (
        _food("avoine", "Flocons d'avoine", "370 13 60 7", "80"),
        _food("lait", "Lait demi-écrémé", "46 3.3 4.8 1.6", "250"),
        _food("banane", "Banane", "90 1.1 20 0.3", "120"),
        _food("oeufs", "Œufs", "140 12.5 0.5 9.5", "60"),
        _food("poulet", "Blanc de poulet cuit", "160 31 0 3.5", "150"),
        _food("riz", "Riz basmati cuit", "130 3 28 0.4"),
        _food("brocoli", "Brocoli cuit", "35 2.8 4 0.4"),
        _food("huile", "Huile d'olive", "900 0 0 100", "10"),
        _food("fromage-blanc", "Fromage blanc 3 %", "80 7.5 4 3.2", "200"),
        _food("amandes", "Amandes", "620 21 8 52", "30"),
        _food("saumon", "Pavé de saumon cuit", "210 22 0 13", "150"),
        _food("pain", "Pain complet", "245 9 43 3", "60"),
    )
}

# Repas type, près de 3 000 kcal (prise de masse) : (repas, aliment, grammes).
DAY: tuple[tuple[str, str, int], ...] = (
    (Meal.BREAKFAST, "avoine", 100),
    (Meal.BREAKFAST, "lait", 250),
    (Meal.BREAKFAST, "banane", 120),
    (Meal.BREAKFAST, "oeufs", 120),
    (Meal.LUNCH, "poulet", 180),
    (Meal.LUNCH, "riz", 300),
    (Meal.LUNCH, "brocoli", 150),
    (Meal.LUNCH, "huile", 10),
    (Meal.SNACK, "fromage-blanc", 200),
    (Meal.SNACK, "amandes", 30),
    (Meal.SNACK, "banane", 120),
    (Meal.DINNER, "saumon", 150),
    (Meal.DINNER, "riz", 250),
    (Meal.DINNER, "huile", 10),
    (Meal.DINNER, "pain", 80),
)
# Aujourd'hui, la journée n'est pas finie : petit-déjeuner et déjeuner seulement.
TODAY_MEALS = (Meal.BREAKFAST, Meal.LUNCH)


@dataclass(frozen=True)
class PlannedEntry:
    id: UUID
    day: date
    meal: str
    food_id: UUID
    grams: Decimal


@dataclass(frozen=True)
class PlannedDay:
    day: date
    entries: tuple[PlannedEntry, ...]
    water_ml: int


def plan(*, today: date) -> list[PlannedDay]:
    """`DAYS` jours de repas jusqu'à aujourd'hui, quantités variées, collation parfois sautée."""
    days = []
    for index in range(DAYS):
        day = today - timedelta(days=DAYS - 1 - index)
        skip_snack = draw("collation", day) < SKIPPED_SNACK
        entries = []
        for meal, key, grams in DAY:
            if day == today and meal not in TODAY_MEALS:
                continue
            if meal == Meal.SNACK and skip_snack:
                continue
            factor = 1 + SPREAD * (draw("quantité", day, meal, key) - 0.5)
            entries.append(
                PlannedEntry(
                    id=stable_id("journal", day, meal, key),
                    day=day,
                    meal=meal,
                    food_id=FOODS[key].id,
                    grams=Decimal(round(grams * factor / 5) * 5),
                )
            )
        water = 1500 + 250 * int(draw("eau", day) * 6)
        days.append(PlannedDay(day=day, entries=tuple(entries), water_ml=water))
    return days
