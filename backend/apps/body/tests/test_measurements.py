"""Mensurations (ADR 0007) : chiffrées au repos, une par jour et par endroit, isolées par compte."""

from datetime import date
from decimal import Decimal
from typing import Any, get_args

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.test import Client, override_settings

from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.body import selectors, services
from apps.body.api.router import SiteName
from apps.body.models import BodyMeasurement, Site

pytestmark = pytest.mark.django_db

API = "/api/v1/body-measurements"
DAY = date(2026, 10, 1)


class Athlete:
    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def put(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.put(
            f"{API}/{path}", body, content_type="application/json", headers=self.headers
        )

    def get(self, query: str = "") -> Any:
        return self.client.get(f"{API}/{query}", headers=self.headers)

    def delete(self, path: str) -> Any:
        return self.client.delete(f"{API}/{path}", headers=self.headers)


def test_the_api_sites_match_the_model() -> None:
    assert set(get_args(SiteName)) == set(Site.values)


def test_the_length_is_encrypted_at_rest() -> None:
    user = make_verified_user()
    row, created = services.put_measurement(
        owner=user, day=DAY, site=Site.ARM, length_m=Decimal("0.385")
    )

    with connection.cursor() as cursor:
        cursor.execute("SELECT length_m FROM body_bodymeasurement WHERE id = %s", [row.pk])
        raw: str = cursor.fetchone()[0]
    assert created
    assert "385" not in raw
    assert BodyMeasurement.objects.get(pk=row.pk).length_m == Decimal("0.385")


def test_one_measurement_per_day_and_site() -> None:
    user = make_verified_user()
    services.put_measurement(owner=user, day=DAY, site=Site.ARM, length_m=Decimal("0.38"))
    services.put_measurement(owner=user, day=DAY, site=Site.WAIST, length_m=Decimal("0.82"))
    _, created = services.put_measurement(
        owner=user, day=DAY, site=Site.ARM, length_m=Decimal("0.39")
    )

    assert not created
    assert BodyMeasurement.objects.filter(owner=user).count() == 2
    with pytest.raises(IntegrityError), transaction.atomic():
        BodyMeasurement.objects.create(owner=user, date=DAY, site=Site.ARM, length_m=Decimal(1))


@pytest.mark.parametrize(
    ("site", "length", "field"),
    [
        ("arm", "0.099", "length_m"),
        ("arm", "2.501", "length_m"),
        ("ear", "0.2", "site"),
    ],
)
def test_an_implausible_measurement_is_refused(site: str, length: str, field: str) -> None:
    user = make_verified_user()

    with pytest.raises(ValidationError) as error:
        services.put_measurement(owner=user, day=DAY, site=site, length_m=Decimal(length))

    assert error.value.message_dict.keys() == {field}


def test_the_api_writes_lists_and_deletes_idempotently() -> None:
    me = Athlete()

    created = me.put("2026-10-01/arm/", {"length_m": "0.385"})
    replaced = me.put("2026-10-01/arm/", {"length_m": 0.39})
    me.put("2026-10-01/waist/", {"length_m": 0.82})

    assert created.status_code == 201
    assert created.json() == {"date": "2026-10-01", "site": "arm", "length_m": 0.385}
    assert replaced.status_code == 200
    listing = me.get("?start=2026-09-01&end=2026-10-31").json()
    assert listing == [
        {"date": "2026-10-01", "site": "arm", "length_m": 0.39},
        {"date": "2026-10-01", "site": "waist", "length_m": 0.82},
    ]
    assert me.delete("2026-10-01/arm/").status_code == 204
    assert me.delete("2026-10-01/arm/").status_code == 204
    assert [row["site"] for row in me.get("?start=2026-09-01&end=2026-10-31").json()] == ["waist"]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("2026-10-01/ear/", {"length_m": "0.2"}),
        ("2026-10-01/arm/", {"length_m": "3.25"}),
        ("2026-10-01/arm/", {"length_m": "0.3855"}),
        ("1999-12-31/arm/", {"length_m": "0.38"}),
    ],
)
def test_an_invalid_measurement_is_refused_without_echoing_it(
    path: str, body: dict[str, Any]
) -> None:
    response = Athlete().put(path, body)

    assert response.status_code == 422
    for value in body.values():
        assert str(value) not in response.content.decode()
    assert not BodyMeasurement.objects.exists()


def test_another_account_never_sees_nor_deletes_my_measurements() -> None:
    me, other = Athlete(), Athlete()
    me.put("2026-10-01/arm/", {"length_m": 0.38})

    assert other.get("?start=2026-09-01&end=2026-10-31").json() == []
    assert other.delete("2026-10-01/arm/").status_code == 204
    assert BodyMeasurement.objects.filter(owner=me.user).count() == 1
    other.put("2026-10-01/arm/", {"length_m": 0.3})

    assert selectors.list_measurements(owner=me.user, start=DAY, end=DAY)[0].length_m == Decimal(
        "0.380"
    )


def test_measurements_require_authentication(client: Client) -> None:
    assert client.get(f"{API}/").status_code == 401
    put = client.put(f"{API}/2026-10-01/arm/", {"length_m": 0.38}, content_type="application/json")
    assert put.status_code == 401


def test_measurements_are_exported_and_deleted_with_the_account() -> None:
    user = make_verified_user()
    services.put_measurement(owner=user, day=DAY, site=Site.CALF, length_m=Decimal("0.4"))

    assert export_account(user)["body_measurements"] == [
        {"date": "2026-10-01", "site": "calf", "length_m": 0.4}
    ]
    delete_account(user=user, password=TEST_PASSWORD)
    assert not BodyMeasurement.objects.exists()


@override_settings(ACCOUNT_RATE_LIMITS={"body_write": "2/m/user"})
def test_measurement_writes_share_the_body_rate_limit() -> None:
    me = Athlete()

    assert me.put("2026-10-01/arm/", {"length_m": 0.38}).status_code == 201
    assert me.delete("2026-10-01/arm/").status_code == 204
    assert me.put("2026-10-01/arm/", {"length_m": 0.38}).status_code == 429
    assert me.delete("2026-10-01/arm/").status_code == 429
