from typing import Any

from apps.training.models import Category, Exercise, NameLanguage


def make_exercise(**overrides: Any) -> Exercise:
    values: dict[str, Any] = {
        "name": "Développé couché",
        "name_language": NameLanguage.FRENCH,
        "category": Category.CHEST,
        "license": "CC-BY-SA 4",
        **overrides,
    }
    return Exercise.objects.create(**values)
