"""Connexion Basic-Fit (ADR 0014) : drapeau, `state` vérifié, usage unique, jetons chiffrés et
jamais exposés, isolation entre comptes, passerelle seule à importer le paquet. Aucun appel
réseau : la passerelle est simulée."""

import ast
import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from django.conf import settings
from django.db import connection as db
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.integrations.basicfit import gateway as gw
from apps.integrations.basicfit import services
from apps.integrations.basicfit.models import Connection, PendingLogin
from common import crypto

pytestmark = pytest.mark.django_db

STATE = "etat-temoin-0123456789"
# Jetons fictifs : aucune vraie réponse Basic-Fit dans le dépôt public.
TOKENS = json.dumps({"refresh_token": "rafraichissement-fictif", "access_token": "acces-fictif"})


class FakeGateway(gw.BasicFitGateway):
    def __init__(self, outcome: Exception | None = None) -> None:
        self.outcome = outcome
        self.exchanged: list[tuple[str, str]] = []

    def start_login(self) -> gw.LoginStart:
        return gw.LoginStart(
            authorize_url="https://login.basic-fit.com/login?state=" + STATE,
            state=STATE,
            verifier="verificateur-fictif",
        )

    def exchange_code(self, *, code: str, verifier: str) -> str:
        self.exchanged.append((code, verifier))
        if self.outcome:
            raise self.outcome
        return TOKENS


def redirect(state: str = STATE, code: str = "code-fictif-abcdef") -> str:
    return f"com.basicfit.trainingapp:/oauthredirect?code={code}&state={state}"


@pytest.fixture(autouse=True)
def enabled(settings: Any) -> None:
    settings.BASICFIT_ENABLED = True


def connect(user: User, fake: FakeGateway | None = None, url: str | None = None) -> Connection:
    fake = fake or FakeGateway()
    services.start_login(owner=user, gateway=fake)
    return services.complete_login(owner=user, redirect_url=url or redirect(), gateway=fake)


# --- Services --------------------------------------------------------------------------------


def test_a_login_stores_encrypted_tokens_and_consumes_the_pending_login() -> None:
    user = make_verified_user()
    fake = FakeGateway()

    connection = connect(user, fake)

    assert fake.exchanged == [("code-fictif-abcdef", "verificateur-fictif")]
    assert connection.status == Connection.Status.CONNECTED
    assert not PendingLogin.objects.exists()
    with db.cursor() as cursor:
        cursor.execute("SELECT tokens FROM basicfit_connection")
        (stored,) = cursor.fetchone() or ("",)
    assert stored.startswith("gAAAA")
    assert "rafraichissement-fictif" not in stored
    assert json.loads(crypto.decrypt(stored).rstrip(chr(0))) == json.loads(TOKENS)


@pytest.mark.parametrize(
    "url",
    [
        redirect(state="un-autre-etat-0123456"),
        "com.basicfit.trainingapp:/oauthredirect?code=code-fictif-abcdef",  # sans state
        "code-fictif-abcdef",  # code seul
        "https://evil.example/oauthredirect?code=code-fictif-abcdef&state=" + STATE,
        redirect() + "&code=deuxieme-code-fictif",
        redirect(code="<script>"),
        redirect() + "x" * 5000,
    ],
)
def test_a_redirect_without_our_state_is_refused_and_single_use(url: str) -> None:
    user = make_verified_user()
    fake = FakeGateway()
    services.start_login(owner=user, gateway=fake)

    with pytest.raises(services.RedirectRefusedError):
        services.complete_login(owner=user, redirect_url=url, gateway=fake)
    assert fake.exchanged == []
    # Usage unique : la bonne URL ne sert plus après un échec.
    with pytest.raises(services.RedirectRefusedError):
        services.complete_login(owner=user, redirect_url=redirect(), gateway=fake)


def test_an_expired_login_is_refused() -> None:
    user = make_verified_user()
    services.start_login(owner=user, gateway=FakeGateway())
    PendingLogin.objects.update(created_at=timezone.now() - timedelta(minutes=11))

    with pytest.raises(services.RedirectRefusedError):
        services.complete_login(owner=user, redirect_url=redirect(), gateway=FakeGateway())


def test_another_accounts_pending_login_is_not_usable() -> None:
    me, other = make_verified_user(), make_verified_user()
    services.start_login(owner=me, gateway=FakeGateway())

    with pytest.raises(services.RedirectRefusedError):
        services.complete_login(owner=other, redirect_url=redirect(), gateway=FakeGateway())
    assert PendingLogin.objects.filter(owner=me).exists()


@pytest.mark.parametrize(
    ("error", "raised"),
    [
        (gw.GatewayAuthError(), services.LoginRefusedError),
        (gw.GatewayError(), services.UnavailableError),
    ],
)
def test_basicfit_failures_become_our_errors(error: Exception, raised: type[Exception]) -> None:
    with pytest.raises(raised):
        connect(make_verified_user(), FakeGateway(error))
    assert not Connection.objects.exists()


def test_disabled_integration_refuses_everything(settings: Any) -> None:
    settings.BASICFIT_ENABLED = False
    with pytest.raises(services.DisabledError):
        services.start_login(owner=make_verified_user(), gateway=FakeGateway())


def test_disconnect_forgets_tokens_and_is_idempotent() -> None:
    user = make_verified_user()
    connect(user)

    services.disconnect(owner=user)
    services.disconnect(owner=user)

    assert not Connection.objects.exists()


# --- Passerelle ------------------------------------------------------------------------------


def test_the_gateway_maps_package_errors_without_their_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from basicfit.auth import AuthManager
    from basicfit.exceptions import BasicFitAPIError, BasicFitAuthError

    async def refused(*_args: Any, **_kwargs: Any) -> Any:
        raise BasicFitAuthError("réponse du serveur : jeton-secret-fictif")

    monkeypatch.setattr(AuthManager, "async_exchange_code", refused)
    with pytest.raises(gw.GatewayAuthError) as caught:
        gw.BasicFitGateway().exchange_code(code="code", verifier="verificateur")
    assert "jeton-secret-fictif" not in str(caught.value)
    assert caught.value.__suppress_context__

    async def broken(*_args: Any, **_kwargs: Any) -> Any:
        raise BasicFitAPIError("panne")

    monkeypatch.setattr(AuthManager, "async_exchange_code", broken)
    with pytest.raises(gw.GatewayError):
        gw.BasicFitGateway().exchange_code(code="code", verifier="verificateur")


def test_the_gateway_builds_a_pkce_login() -> None:
    start = gw.BasicFitGateway().start_login()

    assert start.authorize_url.startswith("https://login.basic-fit.com/login?")
    assert "code_challenge_method=S256" in start.authorize_url
    assert start.verifier not in start.authorize_url
    assert f"state={start.state}" in start.authorize_url


def test_only_the_gateway_imports_the_basicfit_package() -> None:
    root = Path(settings.BASE_DIR)
    offenders = []
    for path in root.rglob("*.py"):
        relative = path.relative_to(root).as_posix()
        if relative.startswith((".venv/", "apps/integrations/basicfit/tests/")) or relative == (
            "apps/integrations/basicfit/gateway.py"
        ):
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else []
            )
            if any(n == "basicfit" or n.startswith("basicfit.") for n in names):
                offenders.append(relative)
    assert offenders == []


# --- API -------------------------------------------------------------------------------------


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeGateway:
    instance = FakeGateway()
    monkeypatch.setattr(services, "BasicFitGateway", lambda: instance)
    return instance


def api(client: Client, user: User) -> dict[str, str]:
    return bearer(login(client, user.email)["access_token"])


@pytest.mark.usefixtures("fake")
def test_the_api_connects_without_ever_returning_tokens(client: Client) -> None:
    user = make_verified_user()
    headers = api(client, user)

    assert client.get("/api/v1/basicfit/connection/", headers=headers).json()["status"] == "none"
    started = client.post("/api/v1/basicfit/connection/start/", headers=headers).json()
    assert started["authorize_url"].startswith("https://login.basic-fit.com/")
    done = client.post(
        "/api/v1/basicfit/connection/complete/",
        {"redirect_url": redirect()},
        content_type="application/json",
        headers=headers,
    )

    assert done.status_code == 200
    assert done.json()["status"] == "connected"
    assert "fictif" not in done.content.decode()
    assert client.delete("/api/v1/basicfit/connection/", headers=headers).status_code == 204


@pytest.mark.usefixtures("fake")
def test_a_refused_redirect_never_echoes_the_url(client: Client) -> None:
    user = make_verified_user()
    headers = api(client, user)
    client.post("/api/v1/basicfit/connection/start/", headers=headers)

    response = client.post(
        "/api/v1/basicfit/connection/complete/",
        {"redirect_url": redirect(state="mauvais-etat-0123456")},
        content_type="application/json",
        headers=headers,
    )

    assert response.status_code == 422
    assert "code-fictif" not in response.content.decode()


def test_disabled_writes_are_not_found(client: Client, settings: Any) -> None:
    settings.BASICFIT_ENABLED = False
    headers = api(client, make_verified_user())

    assert client.get("/api/v1/basicfit/connection/", headers=headers).json() == {
        "enabled": False,
        "status": "disabled",
        "connected_at": None,
        "last_sync_at": None,
        "last_error": "",
    }
    assert client.post("/api/v1/basicfit/connection/start/", headers=headers).status_code == 404
    assert client.get("/api/v1/basicfit/connection/").status_code == 401


@pytest.mark.usefixtures("fake")
def test_b_never_sees_or_completes_as_connection(client: Client) -> None:
    me, other = make_verified_user(), make_verified_user()
    connect(me)
    services.start_login(owner=me, gateway=FakeGateway())
    headers = api(client, other)

    assert client.get("/api/v1/basicfit/connection/", headers=headers).json()["status"] == "none"
    completed = client.post(
        "/api/v1/basicfit/connection/complete/",
        {"redirect_url": redirect()},
        content_type="application/json",
        headers=headers,
    )
    assert completed.status_code == 422
    client.delete("/api/v1/basicfit/connection/", headers=headers)
    assert Connection.objects.filter(owner=me).exists()


@override_settings(ACCOUNT_RATE_LIMITS={"basicfit_connect": "2/3600s/user"})
@pytest.mark.usefixtures("fake")
def test_connection_attempts_are_rate_limited(client: Client) -> None:
    headers = api(client, make_verified_user())
    statuses = [
        client.post("/api/v1/basicfit/connection/start/", headers=headers).status_code
        for _ in range(3)
    ]

    assert statuses == [200, 200, 429]


# --- RGPD ------------------------------------------------------------------------------------


def test_the_export_never_contains_tokens_and_deletion_removes_them() -> None:
    user = make_verified_user()
    connect(user)

    exported = export_account(user)
    assert exported["basicfit"]["status"] == "connected"
    assert "fictif" not in json.dumps(exported, default=str)
    delete_account(user=user, password=TEST_PASSWORD)
    assert not Connection.objects.exists()
