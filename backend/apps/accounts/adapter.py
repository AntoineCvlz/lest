import ipaddress
import secrets
from typing import Any

from allauth.account.adapter import DefaultAccountAdapter
from allauth.core import ratelimit
from django.contrib.auth.hashers import make_password
from django.http import HttpRequest

from .models import normalize_email

# Plafonds journaliers (`ACCOUNT_RATE_LIMITS`) : seconds facteurs refusés d'un compte, et mots
# de passe faux d'une même IP sur un même compte.
DAILY_FAILURES = "login_failed_daily"
DAILY_FAILURES_PER_IP = "login_failed_ip_daily"

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
        """Limites d'allauth, puis les plafonds journaliers propres à Lest.

        - Seconds facteurs refusés (mot de passe déjà prouvé) : 30/jour par compte. Ils ne sont
          pas remis à zéro par un reset, qui rendrait sinon des essais à qui a le mot de passe
          et la boîte mail.
        - Mots de passe faux : 50/jour par (compte, IP). Un plafond par compte seul permettrait
          à n'importe qui, avec la seule adresse, de bloquer le compte pour tout le monde.
        """
        super().pre_authenticate(request, **credentials)
        email = str(credentials.get("email", "")).lower()
        if not email:
            return
        blocked = not ratelimit.consume(request, action=DAILY_FAILURES, key=email, dry_run=True)
        blocked = blocked or not ratelimit.consume(
            request,
            action=DAILY_FAILURES_PER_IP,
            key=self._account_and_ip(request, email),
            dry_run=True,
        )
        if blocked:
            raise self.validation_error("too_many_login_attempts")

    def authentication_failed(self, request: HttpRequest, **credentials: Any) -> None:
        super().authentication_failed(request, **credentials)
        email = str(credentials.get("email", "")).lower()
        if email:
            ratelimit.consume(
                request,
                action=DAILY_FAILURES_PER_IP,
                key=self._account_and_ip(request, email),
            )

    def _account_and_ip(self, request: HttpRequest, email: str) -> str:
        return f"{email}|{self.get_client_ip(request)}"
