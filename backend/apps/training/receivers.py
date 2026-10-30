from typing import Any

from django.dispatch import receiver

from apps.accounts.events import one_rm_formula_changed

from .services import recompute_all_records


@receiver(one_rm_formula_changed)
def on_one_rm_formula_changed(sender: Any, user: Any, **kwargs: Any) -> None:
    """Formule du 1RM changée dans le profil : records de 1RM estimé recalculés."""
    recompute_all_records(owner=user)
