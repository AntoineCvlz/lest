import ipaddress
import secrets
from typing import Any

from allauth.account.adapter import DefaultAccountAdapter
from allauth.core import ratelimit
from django.contrib.auth.hashers import make_password
from django.http import HttpRequest

from .models import normalize_email

# Plafond journalier des échecs d'un compte (`ACCOUNT_RATE_LIMITS["login_failed_daily"]`).
DAILY_FAILURES = "login_failed_daily"

# IP du navigateur, posée par le proxy Next.js (seul point d'entrée de Django) qui écrase toute
# valeur envoyée par le client. `X-Forwarded-For` n'est jamais lu : le client le contrôle.
CLIENT_IP_HEADER = "X-Lest-Client-IP"


class AccountAdapter(DefaultAccountAdapter):
    """Adaptateur allauth : mêmes règles d'e-mail que le modèle `User`, IP client du proxy."""

    def clean_email(self, email: str) -> str:
        # Normalisation identique au manager : « Antoine@X.fr » et « antoine@x.fr » sont un seul
        # compte (la contrainte Lower(email) en base le garantit de toute façon).
        return normalize_email(super().clean_email(email))

    def send_account_already_exists_mail(self, email: str) -> None:
        """Inscription sur une adresse déjà prise : même travail de hachage qu'une création.

        allauth ne hache le mot de passe que pour un nouveau compte ; sans ce hachage factice,
        le temps de réponse (Argon2) révélerait que l'adresse est inscrite.
        """
        make_password(secrets.token_urlsafe(32))
        super().send_account_already_exists_mail(email)

    def get_client_ip(self, request: HttpRequest) -> str:
        """IP retenue par la limitation de débit : en-tête du proxy si valide, sinon le socket."""
        try:
            return str(ipaddress.ip_address(request.headers.get(CLIENT_IP_HEADER, "").strip()))
        except ValueError:
            # Sans proxy (appel direct en dev) : REMOTE_ADDR, allauth ignorant X-Forwarded-For.
            ip: str = super().get_client_ip(request)
            return ip

    def pre_authenticate(self, request: HttpRequest, **credentials: Any) -> None:
        """Limites d'allauth, puis refus si le compte a atteint son plafond journalier d'échecs."""
        super().pre_authenticate(request, **credentials)
        email = str(credentials.get("email", "")).lower()
        if email and not ratelimit.consume(request, action=DAILY_FAILURES, key=email, dry_run=True):
            raise self.validation_error("too_many_login_attempts")

    def authentication_failed(self, request: HttpRequest, **credentials: Any) -> None:
        super().authentication_failed(request, **credentials)
        email = str(credentials.get("email", "")).lower()
        if email:
            ratelimit.consume(request, action=DAILY_FAILURES, key=email)
