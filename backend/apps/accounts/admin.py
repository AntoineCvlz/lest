from typing import TYPE_CHECKING, ClassVar

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User

# UserAdmin n'est générique que pour le typage (django-stubs) : pas d'indice à l'exécution,
# ce qui évite d'ajouter django-stubs-ext en dépendance de production.
if TYPE_CHECKING:
    BaseUserAdmin = DjangoUserAdmin[User]
else:
    BaseUserAdmin = DjangoUserAdmin


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Administration des comptes, identifiés par l'e-mail (pas de nom d'utilisateur)."""

    ordering = ("email",)
    list_display = ("email", "is_active", "is_staff", "date_joined")
    list_filter = ("is_active", "is_staff", "is_superuser")
    search_fields = ("email",)
    readonly_fields = ("date_joined", "last_login")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Droits", {"fields": ("is_active", "is_staff", "is_superuser", "groups")}),
        ("Dates", {"fields": ("date_joined", "last_login")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)
    filter_horizontal: ClassVar[tuple[str, ...]] = ("groups",)
