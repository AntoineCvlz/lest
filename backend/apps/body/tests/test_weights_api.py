"""API des pesées (ADR 0007) : idempotence sur la date, erreurs sans la valeur, isolation."""

from datetime import timedelta
from typing import Any

import pytest
from django.core.exceptions import FieldError
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.body.models import BodyWeight

pytestmark = pytest.mark.django_db

API = "/api/v1"


class Athlete:
    """Un compte connecté et ses appels à l'API."""

    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def put(self, day: str, body: dict[str, Any]) -> Any:
        return self.client.put(
            f"{API}/body-weights/{day}/",
            body,
            content_type="application/json",
            headers=self.headers,
        )

    def get(self, query: str = "") -> Any:
        return self.client.get(f"{API}/body-weights/{query}", headers=self.headers)

    def delete(self, day: str) -> Any:
        return self.client.delete(f"{API}/body-weights/{day}/", headers=self.headers)


def test_weights_require_authentication(client: Client) -> None:
    assert client.get(f"{API}/body-weights/").status_code == 401
    put = client.put(
        f"{API}/body-weights/2026-10-01/", {"weight_kg": 80}, content_type="application/json"
    )
    assert put.status_code == 401


def test_put_creates_then_replaces_the_days_weight() -> None:
    me = Athlete()

    created = me.put("2026-10-01", {"weight_kg": "80.4"})
    replaced = me.put("2026-10-01", {"weight_kg": 80.2})

    assert created.status_code == 201
    assert created.json() == {"date": "2026-10-01", "weight_kg": 80.4}
    assert replaced.status_code == 200
    assert replaced.json()["weight_kg"] == 80.2
    assert BodyWeight.objects.filter(owner=me.user).count() == 1


def test_listing_returns_the_period_with_its_trend() -> None:
    me = Athlete()
    today = timezone.localdate()
    me.put((today - timedelta(days=1)).isoformat(), {"weight_kg": 80})
    me.put(today.isoformat(), {"weight_kg": 81})
    me.put((today - timedelta(days=200)).isoformat(), {"weight_kg": 90})

    response = me.get()

    assert response.status_code == 200
    # 90 derniers jours par défaut : la pesée d'il y a 200 jours n'y est pas.
    assert response.json() == [
        {
            "date": (today - timedelta(days=1)).isoformat(),
            "weight_kg": 80.0,
            "trend_kg": 80.0,
            "source": "manual",
        },
        {"date": today.isoformat(), "weight_kg": 81.0, "trend_kg": 80.5, "source": "manual"},
    ]


@pytest.mark.parametrize(
    "query",
    [
        "?start=2026-10-02&end=2026-10-01",
        # 367 jours, un de trop.
        "?start=2025-01-01&end=2026-01-02",
        "?start=pas-une-date",
        "?start=0001-01-01&end=0001-01-02",
        "?start=9999-12-30&end=9999-12-31",
    ],
)
def test_an_invalid_period_is_refused(query: str) -> None:
    assert Athlete().get(query).status_code == 422


@pytest.mark.parametrize(
    ("day", "body"),
    [
        ("2026-10-01", {"weight_kg": "19.9"}),
        ("2026-10-01", {"weight_kg": "400.5"}),
        ("2026-10-01", {"weight_kg": "80.123"}),
        ("2026-10-01", {}),
        ("1999-12-31", {"weight_kg": "80"}),
        ("2026-02-30", {"weight_kg": "80"}),
    ],
)
def test_an_invalid_weighing_is_refused_without_echoing_it(day: str, body: dict[str, Any]) -> None:
    response = Athlete().put(day, body)

    assert response.status_code == 422
    assert response["Content-Type"] == "application/problem+json"
    # La date est dans `instance` (chemin) ; le poids, donnée de santé, jamais.
    for value in body.values():
        assert str(value) not in response.content.decode()
    assert not BodyWeight.objects.exists()


def test_another_account_never_sees_nor_deletes_my_weights() -> None:
    me, other = Athlete(), Athlete()
    day = timezone.localdate().isoformat()
    me.put(day, {"weight_kg": 80})

    assert other.get().json() == []
    assert other.delete(day).status_code == 204
    other.put(day, {"weight_kg": 60})

    assert me.get().json()[0]["weight_kg"] == 80.0
    assert BodyWeight.objects.filter(owner=me.user).count() == 1


def test_delete_is_idempotent() -> None:
    me = Athlete()
    me.put("2026-10-01", {"weight_kg": 80})

    assert me.delete("2026-10-01").status_code == 204
    assert me.delete("2026-10-01").status_code == 204
    assert not BodyWeight.objects.exists()


@override_settings(ACCOUNT_RATE_LIMITS={"body_write": "2/m/user"})
def test_writes_are_rate_limited_per_account() -> None:
    me = Athlete()

    assert me.put("2026-10-01", {"weight_kg": 80}).status_code == 201
    assert me.delete("2026-10-01").status_code == 204
    limited = me.put("2026-10-01", {"weight_kg": 80})

    assert limited.status_code == 429
    assert Athlete().put("2026-10-01", {"weight_kg": 80}).status_code == 201


def test_encrypted_values_cannot_be_filtered_on() -> None:
    with pytest.raises(FieldError):
        BodyWeight.objects.filter(weight_kg=80).exists()
