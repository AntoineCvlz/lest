from typing import TYPE_CHECKING

from django.contrib import admin
from django.http import HttpRequest

from .models import Exercise

# ModelAdmin n'est générique que pour le typage (django-stubs), comme dans `apps.accounts`.
if TYPE_CHECKING:
    BaseExerciseAdmin = admin.ModelAdmin[Exercise]
else:
    BaseExerciseAdmin = admin.ModelAdmin


@admin.register(Exercise)
class ExerciseAdmin(BaseExerciseAdmin):
    """Consultation du catalogue : il ne se modifie que par l'import wger."""

    list_display = ("name", "name_language", "category", "license", "is_active")
    list_filter = ("category", "name_language", "is_active", "license")
    search_fields = ("name",)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Exercise | None = None) -> bool:
        return False

    def has_delete_permission(self, request: HttpRequest, obj: Exercise | None = None) -> bool:
        return False
