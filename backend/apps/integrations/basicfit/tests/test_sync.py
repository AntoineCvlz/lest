"""Synchronisation Basic-Fit (ADR 0014) : club principal et visites, au plus une fois par heure,
jetons tournés toujours enregistrés, refus des jetons, pannes, isolation, RGPD. Réponses
fictives, aucun appel réseau."""

import json
from datetime import date, timedelta
from typing import Any

import pytest
from django.core.cache import cache
from django.test import Client
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.integrations.basicfit import gateway as gw
from apps.integrations.basicfit import services, tasks
from apps.integrations.basicfit.models import Connection, Visit

pytestmark = pytest.mark.django_db

OLD_TOKENS = json.dumps({"refresh_token": "ancien-fictif"})
NEW_TOKENS = json.dumps({"refresh_token": "nouveau-fictif"})


class FakeGateway(gw.BasicFitGateway):
    def __init__(self, visits: list[gw.Visit] | None = None, error: Exception | None = None):
        self.visits = visits or []
        self.error = error
        self.calls: list[tuple[str, date, date]] = []

    def fetch(self, *, tokens: str, start: date, end: date) -> gw.MemberData:
        self.calls.append((tokens, start, end))
        if self.error:
            raise self.error
        return gw.MemberData(tokens=NEW_TOKENS, home_club="Club témoin", visits=self.visits)


@pytest.fixture(autouse=True)
def enabled(settings: Any) -> None:
    settings.BASICFIT_ENABLED = True
    cache.clear()


def connected(user: User | None = None, **values: Any) -> User:
    user = user or make_verified_user()
    Connection.objects.create(owner=user, tokens=OLD_TOKENS, **values)
    return user


def visit(days_ago: int, club: str = "Club témoin") -> gw.Visit:
    return gw.Visit(day=timezone.localdate() - timedelta(days=days_ago), club=club)


def test_a_first_sync_reads_a_year_and_keeps_the_rotated_tokens() -> None:
    user = connected()
    fake = FakeGateway([visit(1), visit(1, "Autre club"), visit(30), visit(400)])

    result = services.sync(owner=user, gateway=fake)

    tokens, start, end = fake.calls[0]
    assert (tokens, end - start) == (OLD_TOKENS, timedelta(days=364))
    connection = Connection.objects.get()
    assert connection.tokens == NEW_TOKENS
    assert connection.home_club == "Club témoin"
    assert connection.last_sync_at is not None
    # Un passage par jour ; hors de la fenêtre demandée : ignoré.
    assert result.visits == 2
    assert Visit.objects.count() == 2


def test_later_syncs_reread_a_week_and_never_duplicate() -> None:
    user = connected(last_sync_at=timezone.now() - timedelta(hours=2))
    Visit.objects.create(owner=user, date=timezone.localdate() - timedelta(days=1), club="X")
    fake = FakeGateway([visit(1)])

    services.sync(owner=user, gateway=fake)

    _, start, _ = fake.calls[0]
    assert timezone.localdate() - start == timedelta(days=7)
    assert Visit.objects.get().club == "Club témoin"


def test_at_most_one_sync_per_hour() -> None:
    user = connected(last_sync_at=timezone.now() - timedelta(minutes=20))

    with pytest.raises(services.TooSoonError) as caught:
        services.sync(owner=user, gateway=FakeGateway())
    assert timedelta(minutes=39) < caught.value.retry_after <= timedelta(minutes=40)
    assert services.due_for_sync() == []


def test_refused_tokens_mark_the_connection_expired_and_forget_them() -> None:
    user = connected()

    with pytest.raises(services.NotConnectedError):
        services.sync(owner=user, gateway=FakeGateway(error=gw.GatewayAuthError()))

    connection = Connection.objects.get()
    assert (connection.status, connection.tokens, connection.last_error) == (
        Connection.Status.EXPIRED,
        "",
        "auth",
    )
    with pytest.raises(services.NotConnectedError):
        services.sync(owner=user, gateway=FakeGateway())


def test_an_outage_keeps_tokens_rotated_before_it() -> None:
    user = connected()

    with pytest.raises(services.UnavailableError):
        services.sync(owner=user, gateway=FakeGateway(error=gw.GatewayError(NEW_TOKENS)))

    connection = Connection.objects.get()
    assert (connection.tokens, connection.last_error, connection.last_sync_at) == (
        NEW_TOKENS,
        "unavailable",
        None,
    )


def test_concurrent_syncs_of_one_account_are_refused() -> None:
    user = connected()
    cache.add(f"basicfit:sync:{user.pk}", 1)

    with pytest.raises(services.SyncBusyError):
        services.sync(owner=user, gateway=FakeGateway())


def test_disabled_or_unconnected_accounts_are_not_synced(settings: Any) -> None:
    with pytest.raises(services.NotConnectedError):
        services.sync(owner=make_verified_user(), gateway=FakeGateway())
    settings.BASICFIT_ENABLED = False
    with pytest.raises(services.DisabledError):
        services.sync(owner=connected(), gateway=FakeGateway())


# --- Passerelle ------------------------------------------------------------------------------


def test_the_gateway_keeps_only_the_home_club_and_visits(monkeypatch: pytest.MonkeyPatch) -> None:
    from basicfit.client import BasicFitClient
    from basicfit.models import Activity, Member, TokenSet

    # Réponses fictives, à la forme de l'API (aucune vraie donnée Basic-Fit).
    member = Member.from_api(
        {"member": {"name": "Nom fictif", "cardnumber": "0000", "homeClub": "Club\x00 témoin"}}
    )
    feed = [
        Activity.from_api("2026-10-30", {"type": "GYM_VISIT", "clubName": "Club témoin"}),
        Activity.from_api("pas une date", {"type": "GYM_VISIT", "clubName": "Club témoin"}),
    ]

    async def get_member(self: BasicFitClient) -> Member:
        await self._auth._emit_update(TokenSet(refresh_token="tourne-fictif"))
        return member

    async def get_visits(self: BasicFitClient, **_kwargs: Any) -> list[Activity]:
        return feed

    monkeypatch.setattr(BasicFitClient, "get_member", get_member)
    monkeypatch.setattr(BasicFitClient, "get_visits", get_visits)

    data = gw.BasicFitGateway().fetch(
        tokens=OLD_TOKENS, start=date(2026, 10, 1), end=date(2026, 11, 4)
    )

    assert data.home_club == "Club témoin"
    assert data.visits == [gw.Visit(day=date(2026, 10, 30), club="Club témoin")]
    assert json.loads(data.tokens)["refresh_token"] == "tourne-fictif"
    assert "Nom fictif" not in repr(data)


def test_a_gateway_failure_carries_the_rotated_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    from basicfit.client import BasicFitClient
    from basicfit.exceptions import BasicFitAPIError
    from basicfit.models import TokenSet

    async def get_member(self: BasicFitClient) -> Any:
        await self._auth._emit_update(TokenSet(refresh_token="tourne-fictif"))
        raise BasicFitAPIError("panne : réponse du serveur")

    monkeypatch.setattr(BasicFitClient, "get_member", get_member)

    with pytest.raises(gw.GatewayError) as caught:
        gw.BasicFitGateway().fetch(
            tokens=OLD_TOKENS, start=date(2026, 10, 1), end=date(2026, 11, 4)
        )
    assert json.loads(caught.value.tokens or "{}")["refresh_token"] == "tourne-fictif"
    assert "panne" not in str(caught.value)


# --- Tâches ----------------------------------------------------------------------------------


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeGateway:
    instance = FakeGateway([visit(2)])
    monkeypatch.setattr(services, "BasicFitGateway", lambda: instance)
    return instance


@pytest.mark.usefixtures("fake")
def test_the_hourly_task_syncs_only_due_accounts() -> None:
    due = connected()
    connected(last_sync_at=timezone.now())
    connected(status=Connection.Status.EXPIRED)

    assert tasks.sync_due_accounts() == 1
    assert Visit.objects.filter(owner=due).count() == 1


@pytest.mark.usefixtures("fake")
def test_the_task_skips_accounts_with_nothing_to_do(settings: Any) -> None:
    assert tasks.sync_account(str(make_verified_user().pk)) == 0
    settings.BASICFIT_ENABLED = False
    assert tasks.sync_due_accounts() == 0


# --- API -------------------------------------------------------------------------------------


def headers_for(client: Client, user: User) -> dict[str, str]:
    return bearer(login(client, user.email)["access_token"])


@pytest.mark.usefixtures("fake")
def test_a_manual_sync_is_queued_then_refused_within_the_hour(client: Client) -> None:
    user = connected()
    headers = headers_for(client, user)

    assert client.post("/api/v1/basicfit/sync/", headers=headers).status_code == 202
    again = client.post("/api/v1/basicfit/sync/", headers=headers)
    assert again.status_code == 429
    status = client.get("/api/v1/basicfit/connection/", headers=headers).json()
    assert status["home_club"] == "Club témoin"
    assert "fictif" not in json.dumps(status)


def test_a_manual_sync_needs_a_connection(client: Client, settings: Any) -> None:
    headers = headers_for(client, make_verified_user())

    assert client.post("/api/v1/basicfit/sync/", headers=headers).status_code == 409
    settings.BASICFIT_ENABLED = False
    assert client.post("/api/v1/basicfit/sync/", headers=headers).status_code == 404


def test_b_never_reads_as_visits(client: Client) -> None:
    me, other = connected(), make_verified_user()
    Visit.objects.create(owner=me, date=timezone.localdate(), club="Club témoin")

    mine = client.get("/api/v1/basicfit/visits/", headers=headers_for(client, me)).json()
    theirs = client.get("/api/v1/basicfit/visits/", headers=headers_for(client, other)).json()

    assert [v["club"] for v in mine] == ["Club témoin"]
    assert theirs == []
    assert client.get("/api/v1/basicfit/visits/").status_code == 401


def test_visits_and_home_club_are_exported_without_tokens() -> None:
    user = connected(home_club="Club témoin")
    Visit.objects.create(owner=user, date=date(2026, 10, 30), club="Club témoin")

    exported = export_account(user)["basicfit"]

    assert exported["home_club"] == "Club témoin"
    assert exported["visits"] == [{"date": "2026-10-30", "club": "Club témoin"}]
    assert "fictif" not in json.dumps(exported)
