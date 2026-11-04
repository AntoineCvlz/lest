"""Activités (ADR 0012) : catalogue de sports, valeurs validées et chiffrées, écritures
idempotentes, lecture par période, isolation entre comptes, RGPD."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, get_args
from uuid import uuid1, uuid4

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.activities import selectors, services
from apps.activities.api.router import SportKey
from apps.activities.models import MAX_ACTIVITIES_PER_DAY, Activity
from apps.activities.sports import SPORTS

pytestmark = pytest.mark.django_db

DAY = date(2026, 10, 1)


def record(owner: User, **overrides: Any) -> Activity:
    values = {"day": DAY, "sport": "running", "duration_s": 1800, **overrides}
    activity, _ = services.put_activity(
        owner=owner,
        activity_id=overrides.pop("activity_id", uuid4()),
        values=services.ActivityValues(**{k: v for k, v in values.items() if k != "activity_id"}),
    )
    return activity


def rejected(owner: User, **overrides: Any) -> dict[str, list[str]]:
    with pytest.raises(ValidationError) as caught:
        record(owner, **overrides)
    return {
        name: [e.code or "" for e in errors] for name, errors in caught.value.error_dict.items()
    }


# --- Catalogue -------------------------------------------------------------------------------


def test_the_api_literal_matches_the_catalog() -> None:
    assert set(get_args(SportKey)) == set(SPORTS)


def test_every_metric_has_sane_bounds_and_a_unique_key() -> None:
    for sport in SPORTS.values():
        keys = [m.key for m in sport.metrics]
        assert len(keys) == len(set(keys))
        assert all(0 <= m.minimum < m.maximum for m in sport.metrics)


# --- Services --------------------------------------------------------------------------------


def test_an_activity_is_created_then_replaced_under_the_same_id() -> None:
    user = make_verified_user()
    activity_id = uuid4()

    _, created = services.put_activity(
        owner=user,
        activity_id=activity_id,
        values=services.ActivityValues(day=DAY, sport="running", duration_s=1800),
    )
    replaced, again = services.put_activity(
        owner=user,
        activity_id=activity_id,
        values=services.ActivityValues(
            day=DAY,
            sport="swimming",
            duration_s=2400,
            distance_m=Decimal("1500"),
            avg_heart_rate=132,
            feeling=4,
            metrics={"pool_length_m": 25, "laps": 60},
        ),
    )

    assert (created, again) == (True, False)
    assert Activity.objects.count() == 1
    stored = Activity.objects.get()
    assert (stored.sport, int(stored.duration_s or 0), stored.distance_m) == (
        "swimming",
        2400,
        Decimal("1500.0"),
    )
    assert stored.metric_values() == {"laps": 60, "pool_length_m": 25}
    assert replaced.pk == activity_id


@pytest.mark.parametrize(
    ("overrides", "field", "code"),
    [
        ({"sport": "curling"}, "sport", "invalid_choice"),
        ({"duration_s": 59}, "duration_s", "out_of_range"),
        ({"duration_s": 24 * 3600 + 1}, "duration_s", "out_of_range"),
        ({"distance_m": Decimal("-1")}, "distance_m", "out_of_range"),
        ({"distance_m": Decimal("1000000.1")}, "distance_m", "out_of_range"),
        ({"sport": "yoga", "distance_m": Decimal(100)}, "distance_m", "not_allowed"),
        ({"avg_heart_rate": 29}, "avg_heart_rate", "out_of_range"),
        ({"avg_heart_rate": 231}, "avg_heart_rate", "out_of_range"),
        ({"feeling": 0}, "feeling", "out_of_range"),
        ({"feeling": 6}, "feeling", "out_of_range"),
        ({"metrics": {"laps": 10}}, "metrics", "unknown"),
        ({"metrics": {"elevation_gain_m": 10_001}}, "metrics", "out_of_range"),
        ({"day": date(1999, 12, 31)}, "date", "out_of_range"),
    ],
)
def test_values_outside_the_catalog_or_bounds_are_refused(
    overrides: dict[str, Any], field: str, code: str
) -> None:
    assert rejected(make_verified_user(), **overrides) == {field: [code]}
    assert not Activity.objects.exists()


def test_the_day_after_tomorrow_is_refused() -> None:
    day = timezone.localdate() + timedelta(days=2)

    assert rejected(make_verified_user(), day=day) == {"date": ["out_of_range"]}


def test_a_day_holds_at_most_twenty_activities_but_existing_ones_stay_editable() -> None:
    user = make_verified_user()
    ids = [record(user).pk for _ in range(MAX_ACTIVITIES_PER_DAY)]

    assert rejected(user) == {"activity_id": ["too_many"]}
    record(user, activity_id=ids[0], duration_s=600)
    record(user, day=DAY + timedelta(days=1))


def test_another_accounts_id_is_not_found_and_untouched() -> None:
    mine = record(make_verified_user())

    with pytest.raises(services.NotFoundError):
        record(make_verified_user(), activity_id=mine.pk, duration_s=600)
    assert int(Activity.objects.get().duration_s or 0) == 1800


def test_delete_is_idempotent_and_scoped_to_the_owner() -> None:
    me, other = make_verified_user(), make_verified_user()
    mine = record(me)

    services.delete_activity(owner=other, activity_id=mine.pk)
    assert Activity.objects.exists()
    services.delete_activity(owner=me, activity_id=mine.pk)
    services.delete_activity(owner=me, activity_id=mine.pk)
    assert not Activity.objects.exists()


def test_values_are_encrypted_at_rest() -> None:
    activity = record(make_verified_user(), avg_heart_rate=151, metrics={"elevation_gain_m": 321})
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT duration_s, avg_heart_rate, metrics FROM activities_activity WHERE id = %s",
            [activity.pk],
        )
        row = cursor.fetchone()

    assert row is not None
    assert all(value.startswith("gAAAA") for value in row)
    assert not any("1800" in value or "151" in value or "321" in value for value in row)


def test_the_sport_must_belong_to_the_catalog_in_the_database() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Activity.objects.create(
            id=uuid4(),
            owner=make_verified_user(),
            date=DAY,
            sport="curling",
            duration_s=Decimal(60),
        )


def test_unreadable_metrics_read_as_none() -> None:
    activity = record(make_verified_user())
    activity.metrics = "pas du json"

    assert activity.metric_values() == {}
    activity.metrics = '["liste"]'
    assert activity.metric_values() == {}


# --- Selectors -------------------------------------------------------------------------------


def test_the_period_is_inclusive_ordered_and_private() -> None:
    me, other = make_verified_user(), make_verified_user()
    later = record(me, day=DAY + timedelta(days=2))
    first = record(me, day=DAY)
    record(me, day=DAY + timedelta(days=3))
    record(other, day=DAY)

    found = selectors.list_activities(owner=me, start=DAY, end=DAY + timedelta(days=2))

    assert [a.pk for a in found] == [first.pk, later.pk]


# --- API -------------------------------------------------------------------------------------


class Athlete:
    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def get(self, path: str) -> Any:
        return self.client.get(f"/api/v1/{path}", headers=self.headers)

    def put(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.put(
            f"/api/v1/{path}", body, content_type="application/json", headers=self.headers
        )

    def delete(self, path: str) -> Any:
        return self.client.delete(f"/api/v1/{path}", headers=self.headers)


BODY = {"date": "2026-10-01", "sport": "running", "duration_s": 1800}


def test_the_catalog_is_served_to_signed_in_accounts(client: Client) -> None:
    sports = Athlete().get("sports/").json()

    swimming = next(s for s in sports if s["key"] == "swimming")
    assert swimming["has_distance"] is True
    assert {"key": "laps", "label": "Longueurs", "unit": "", "min": 1, "max": 1000} in swimming[
        "metrics"
    ]
    assert client.get("/api/v1/sports/").status_code == 401


def test_the_api_writes_reads_and_deletes() -> None:
    me = Athlete()
    path = f"activities/{uuid4()}/"
    full = {
        **BODY,
        "distance_m": 10000,
        "avg_heart_rate": 148,
        "feeling": 4,
        "metrics": {"elevation_gain_m": 120},
    }

    assert me.put(path, BODY).status_code == 201
    response = me.put(path, full)
    assert response.status_code == 200
    assert response.json() == {"id": path.split("/")[1], **full, "distance_m": 10000.0}
    listed = me.get("activities/?start=2026-09-30&end=2026-10-02").json()
    assert [a["id"] for a in listed] == [path.split("/")[1]]
    assert me.delete(path).status_code == 204
    assert me.delete(path).status_code == 204
    assert me.get("activities/?start=2026-09-30&end=2026-10-02").json() == []


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "sport": "curling"},
        {**BODY, "duration_s": "1800"},
        {**BODY, "duration_s": 30},
        {**BODY, "feeling": 9},
        {**BODY, "sport": "yoga", "distance_m": 500},
        {**BODY, "metrics": {"laps": 3}},
        {**BODY, "metrics": {"elevation_gain_m": True}},
        {**BODY, "metrics": {"elevation_gain_m": "12"}},
        {**BODY, "metrics": {"elevation_gain_m": 1.5}},
        {**BODY, "metrics": {f"m{i}": 1 for i in range(11)}},
    ],
)
def test_invalid_bodies_are_422_without_the_value(body: dict[str, Any]) -> None:
    response = Athlete().put(f"activities/{uuid4()}/", body)

    assert response.status_code == 422
    assert response["Content-Type"] == "application/problem+json"
    assert "curling" not in response.content.decode()
    assert "input" not in response.content.decode()


def test_only_uuid4_ids_are_accepted() -> None:
    assert Athlete().put(f"activities/{uuid1()}/", BODY).status_code == 422


@pytest.mark.parametrize(
    "query",
    ["start=1999-12-31", "start=2026-10-02&end=2026-10-01", "start=2025-01-01&end=2026-01-02"],
)
def test_unbounded_periods_are_refused(query: str) -> None:
    assert Athlete().get(f"activities/?{query}").status_code == 422


def test_b_never_reads_changes_or_deletes_as_activities(client: Client) -> None:
    me, other = Athlete(), Athlete()
    path = f"activities/{uuid4()}/"
    me.put(path, BODY)

    assert other.get("activities/?start=2026-09-30&end=2026-10-02").json() == []
    assert other.put(path, {**BODY, "duration_s": 600}).status_code == 404
    assert other.delete(path).status_code == 204
    assert me.get("activities/?start=2026-09-30&end=2026-10-02").json()[0]["duration_s"] == 1800
    assert client.get("/api/v1/activities/").status_code == 401
    assert client.put(f"/api/v1/{path}", BODY, content_type="application/json").status_code == 401


@override_settings(ACCOUNT_RATE_LIMITS={"activities_write": "2/m/user"})
def test_writes_are_rate_limited() -> None:
    me = Athlete()
    path = f"activities/{uuid4()}/"
    statuses = [me.put(path, BODY).status_code for _ in range(3)]

    assert statuses == [201, 200, 429]


# --- RGPD ------------------------------------------------------------------------------------


def test_activities_are_exported_in_clear_and_deleted_with_the_account() -> None:
    user = make_verified_user()
    activity = record(user, avg_heart_rate=140, metrics={"elevation_gain_m": 50})

    exported = export_account(user)["activities"]
    assert exported == [
        {
            "id": str(activity.pk),
            "date": "2026-10-01",
            "sport": "running",
            "duration_s": 1800,
            "distance_m": None,
            "avg_heart_rate": 140.0,
            "feeling": None,
            "metrics": {"elevation_gain_m": 50},
        }
    ]
    delete_account(user=user, password=TEST_PASSWORD)
    assert not Activity.objects.exists()
