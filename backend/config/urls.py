from django.contrib import admin
from django.urls import include, path

from apps.accounts.mfa_views import SecondFactorRecoveryCodesView, SecondFactorTOTPView

from .api import api

MFA_AUTHENTICATORS = "api/v1/auth/app/v1/account/authenticators/"

urlpatterns = [
    path("admin/", admin.site.urls),
    # Retirer ou révéler un second facteur exige un second facteur : ces vues durcies passent
    # avant celles d'allauth, sur les mêmes URL.
    path(
        f"{MFA_AUTHENTICATORS}totp",
        SecondFactorTOTPView.as_api_view(client="app"),
        name="lest_manage_totp",
    ),
    path(
        f"{MFA_AUTHENTICATORS}recovery-codes",
        SecondFactorRecoveryCodesView.as_api_view(client="app"),
        name="lest_manage_recovery_codes",
    ),
    # Comptes (allauth headless, client `app`) : sous /api/v1/ pour passer par le proxy Next.js.
    path("api/v1/auth/", include("allauth.headless.urls")),
    path("api/v1/", api.urls),
]

handler404 = "common.problems.handler404"
