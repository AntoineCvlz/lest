"""Synchronisation Basic-Fit (ADR 0014) : club principal et visites, au plus une fois par heure,
jetons tournés toujours enregistrés, refus des jetons, pannes, isolation, RGPD. Réponses
fictives, aucun appel réseau."""

import json
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import pytest
from django.core.cache import cache
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.body import services as body
from apps.body.models import BodyWeight, WeightSource
from apps.integrations.basicfit import gateway as gw
from apps.integrations.basicfit import services, tasks
from apps.integrations.basicfit.models import Connection, Visit

pytestmark = pytest.mark.django_db

OLD_TOKENS = json.dumps({"refresh_token": "ancien-fictif"})
NEW_TOKENS = json.dumps({"refresh_token": "nouveau-fictif"})


class FakeGateway(gw.BasicFitGateway):
    def __init__(
        self,
        visits: list[gw.Visit] | None = None,
        error: Exception | None = None,
        weights: list[gw.ScaleWeight] | None = None,
    ):
        self.visits = visits or []
        self.weights = weights or []
        self.error = error
        self.calls: list[tuple[str, date, date]] = []

    def fetch(self, *, tokens: str, start: date, end: date) -> gw.MemberData:
        self.calls.append((tokens, start, end))
        if self.error:
            raise self.error
        return gw.MemberData(
            tokens=NEW_TOKENS, home_club="Club témoin", visits=self.visits, weights=self.weights
        )


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


def scale(days_ago: int, kg: str) -> gw.ScaleWeight:
    return gw.ScaleWeight(
        day=timezone.localdate() - timedelta(days=days_ago), weight_kg=Decimal(kg)
    )


def test_scale_weights_fill_empty_days_and_never_replace_manual_ones() -> None:
    user = connected()
    manual_day = timezone.localdate() - timedelta(days=2)
    body.put_weight(owner=user, day=manual_day, weight_kg=Decimal("81"))
    fake = FakeGateway(
        weights=[scale(1, "80.4"), scale(2, "79.9"), scale(3, "5"), scale(400, "80")]
    )

    result = services.sync(owner=user, gateway=fake)

    assert result.weights == 1
    rows = {row.date: (row.weight_kg, row.source) for row in BodyWeight.objects.filter(owner=user)}
    assert rows == {
        timezone.localdate() - timedelta(days=1): (Decimal("80.40"), WeightSource.BASICFIT),
        manual_day: (Decimal("81.00"), WeightSource.MANUAL),
    }


def test_later_syncs_reread_a_week_and_never_duplicate() -> None:
    user = connected(last_sync_at=timezone.now() - timedelta(hours=2))
    Visit.objects.create(owner=user, date=timezone.localdate() - timedelta(days=1), club="X")
    fake = FakeGateway([visit(1)])

    services.sync(owner=user, gateway=fake)

    _, start, _ = fake.calls[0]
    assert timezone.localdate() - start == timedelta(days=7)
    assert Visit.objects.get().club == "Club témoin"


def test_at_most_one_attempt_per_hour_even_a_failed_one() -> None:
    user = connected(last_attempt_at=timezone.now() - timedelta(minutes=20))

    with pytest.raises(services.TooSoonError) as caught:
        services.sync(owner=user, gateway=FakeGateway())
    assert timedelta(minutes=39) < caught.value.retry_after <= timedelta(minutes=40)
    assert services.due_for_sync() == []


def test_three_refusals_in_a_row_mark_the_connection_expired_and_forget_tokens() -> None:
    user = connected()
    # Refus ou panne du serveur de jetons (indiscernables) : jetons gardés deux fois.
    for _ in range(2):
        with pytest.raises(services.UnavailableError):
            services.sync(owner=user, gateway=FakeGateway(error=gw.GatewayAuthError()))
        assert Connection.objects.get().tokens == OLD_TOKENS
        Connection.objects.update(last_attempt_at=None)

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


def test_a_success_resets_the_refusal_count() -> None:
    user = connected(auth_failures=2)

    services.sync(owner=user, gateway=FakeGateway())

    assert Connection.objects.get().auth_failures == 0


def test_rotated_tokens_survive_a_failure_while_writing_visits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from django.db import DatabaseError

    user = connected()

    def broken(*_args: Any, **_kwargs: Any) -> Any:
        raise DatabaseError

    monkeypatch.setattr(Visit.objects, "update_or_create", broken)
    with pytest.raises(DatabaseError):
        services.sync(owner=user, gateway=FakeGateway([visit(1)]))

    assert Connection.objects.get().tokens == NEW_TOKENS


def test_a_reconnection_during_a_sync_is_never_overwritten() -> None:
    user = connected()

    class Reconnecting(FakeGateway):
        def fetch(self, *, tokens: str, start: date, end: date) -> gw.MemberData:
            Connection.objects.update(tokens="reconnexion-fictive", generation=1)
            return super().fetch(tokens=tokens, start=start, end=end)

    with pytest.raises(services.SyncBusyError):
        services.sync(owner=user, gateway=Reconnecting([visit(1)]))

    assert Connection.objects.get().tokens == "reconnexion-fictive"
    assert not Visit.objects.exists()


def test_the_lock_of_a_later_sync_is_never_released_by_an_earlier_one() -> None:
    user = connected()

    class Overrun(FakeGateway):
        def fetch(self, *, tokens: str, start: date, end: date) -> gw.MemberData:
            # Le verrou a expiré et une autre synchro l'a pris.
            cache.set(f"basicfit:sync:{user.pk}", "autre-synchro")
            return super().fetch(tokens=tokens, start=start, end=end)

    services.sync(owner=user, gateway=Overrun())

    assert cache.get(f"basicfit:sync:{user.pk}") == "autre-synchro"


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
    from basicfit.models import Activity, BodyMeasurement, Member, TokenSet

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

    scale = [
        BodyMeasurement.from_api({"date": "2026-10-30T09:00:00", "weight": 80.44, "fat": 15.2}),
        BodyMeasurement.from_api({"date": "2026-10-30T07:00:00", "weight": 81.0}),
        BodyMeasurement.from_api({"date": "2026-10-20", "weight": None}),
        BodyMeasurement.from_api({"date": "pas une date", "weight": 80}),
    ]

    async def get_body_measurements(self: BasicFitClient, **_kwargs: Any) -> Any:
        return scale

    monkeypatch.setattr(BasicFitClient, "get_member", get_member)
    monkeypatch.setattr(BasicFitClient, "get_visits", get_visits)
    monkeypatch.setattr(BasicFitClient, "get_body_measurements", get_body_measurements)

    data = gw.BasicFitGateway().fetch(
        tokens=OLD_TOKENS, start=date(2026, 10, 1), end=date(2026, 11, 4)
    )

    assert data.home_club == "Club témoin"
    assert data.visits == [gw.Visit(day=date(2026, 10, 30), club="Club témoin")]
    assert json.loads(data.tokens)["refresh_token"] == "tourne-fictif"
    assert "Nom fictif" not in repr(data)
    # Poids seul, une pesée par jour (la plus récente) ; composition corporelle abandonnée.
    assert data.weights == [gw.ScaleWeight(day=date(2026, 10, 30), weight_kg=Decimal("80.44"))]
    assert "15.2" not in repr(data)


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
    connected(last_attempt_at=timezone.now())
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


def test_a_failed_attempt_also_blocks_manual_syncs_for_an_hour(client: Client) -> None:
    user = connected()
    failing = FakeGateway(error=gw.GatewayError())
    with pytest.raises(services.UnavailableError):
        services.sync(owner=user, gateway=failing)

    again = client.post("/api/v1/basicfit/sync/", headers=headers_for(client, user))

    assert again.status_code == 429
    assert len(failing.calls) == 1
    assert services.due_for_sync() == []


def test_a_queued_sync_is_not_queued_twice() -> None:
    user = connected()
    services.request_sync(owner=user)

    with pytest.raises(services.TooSoonError):
        services.request_sync(owner=user)


@override_settings(ACCOUNT_RATE_LIMITS={"basicfit_sync": "1/3600s/user"})
def test_manual_syncs_are_rate_limited(client: Client) -> None:
    headers = headers_for(client, make_verified_user())

    statuses = [
        client.post("/api/v1/basicfit/sync/", headers=headers).status_code for _ in range(2)
    ]

    assert statuses == [409, 429]


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
