from django.contrib import admin
from django.urls import include, path

from .api import api

urlpatterns = [
    path("admin/", admin.site.urls),
    # Comptes (allauth headless, client `app`) : sous /api/v1/ pour passer par le proxy Next.js.
    path("api/v1/auth/", include("allauth.headless.urls")),
    path("api/v1/", api.urls),
]

handler404 = "common.problems.handler404"
