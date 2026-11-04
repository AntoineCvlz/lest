"""Scan d'un code-barres (Open Food Facts, ADR 0009) et aliments perso : produits fictifs,
aucun appel réseau."""

import io
import json
from datetime import timedelta
from decimal import Decimal
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request
from uuid import uuid1, uuid4

import pytest
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.nutrition import openfoodfacts, services
from apps.nutrition.models import Food, FoodSource

pytestmark = pytest.mark.django_db

CODE = "2000000000008"  # code GTIN fictif, clé de contrôle valide


def someone() -> Any:
    """Compte jetable, pour les appels où le compte importe peu."""
    return make_verified_user()


def answer(**product: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "product_name_fr": "Barre témoin protéinée",
        "brands": "Marque témoin, Autre marque",
        "serving_quantity": 40,
        "nutriments": {
            "energy-kcal_100g": 380,
            "proteins_100g": 30.04,
            "carbohydrates_100g": 35,
            "fat_100g": 12.5,
        },
    }
    return {"code": CODE, "status": 1, "product": {**base, **product}}


def product(**overrides: Any) -> openfoodfacts.OffProduct:
    found = openfoodfacts.parse_product(CODE, answer(**overrides))
    assert found is not None
    return found


@pytest.mark.parametrize(
    ("code", "valid"),
    [
        ("3017624010701", True),
        ("2000000000008", True),
        ("2000000000009", False),
        ("96385074", True),
        ("20000000000", False),
        ("2000000000OO8", False),
        ("²000000000008", False),
    ],
)
def test_barcodes_need_a_valid_check_digit(code: str, valid: bool) -> None:
    assert openfoodfacts.valid_barcode(code) is valid


def test_a_product_is_read_and_rounded() -> None:
    found = product()

    assert found == openfoodfacts.OffProduct(
        code=CODE,
        name="Barre témoin protéinée",
        brand="Marque témoin",
        kcal=Decimal("380.0"),
        protein=Decimal("30.0"),
        carbs=Decimal("35.0"),
        fat=Decimal("12.5"),
        serving_g=Decimal("40.0"),
    )
    assert product(product_name_fr=None, product_name="Test bar").name == "Test bar"
    assert product(serving_quantity=0).serving_g is None


def test_an_unknown_product_is_none() -> None:
    assert openfoodfacts.parse_product(CODE, {"code": CODE, "status": 0}) is None


@pytest.mark.parametrize(
    "product_overrides",
    [
        {"product_name_fr": None, "product_name": None},
        {"nutriments": {}},
        {"nutriments": {"energy-kcal_100g": 1200}},
        {"nutriments": {"energy-kcal_100g": 100, "proteins_100g": 150}},
    ],
)
def test_an_unusable_product_is_refused(product_overrides: dict[str, Any]) -> None:
    with pytest.raises(openfoodfacts.UnusableProductError):
        openfoodfacts.parse_product(CODE, answer(**product_overrides))


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def test_the_request_identifies_lest_and_stays_on_https(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Request] = []

    def opener(request: Request, *, timeout: int) -> FakeResponse:
        seen.append(request)
        return FakeResponse(json.dumps(answer()).encode())

    found = openfoodfacts.fetch_product(
        CODE, base_url="https://off.test", contact="contact.test", opener=opener
    )

    assert found is not None
    assert seen[0].full_url.startswith(f"https://off.test/api/v2/product/{CODE}?fields=")
    assert seen[0].get_header("User-agent") == "Lest/1.0 (contact.test)"
    with pytest.raises(openfoodfacts.OffError):
        openfoodfacts.fetch_product(CODE, base_url="http://off.test", contact="c", opener=opener)
    monkeypatch.setattr(openfoodfacts, "MAX_BYTES", 10)
    with pytest.raises(openfoodfacts.OffError):
        openfoodfacts.fetch_product(CODE, base_url="https://off.test", contact="c", opener=opener)


@pytest.mark.parametrize(("status", "outcome"), [(404, None), (500, "error")])
def test_http_errors_from_off(status: int, outcome: str | None) -> None:
    def opener(request: Request, *, timeout: int) -> FakeResponse:
        raise HTTPError(request.full_url, status, "erreur", {}, None)  # type: ignore[arg-type]

    if outcome is None:
        assert (
            openfoodfacts.fetch_product(
                CODE, base_url="https://off.test", contact="c", opener=opener
            )
            is None
        )
    else:
        with pytest.raises(openfoodfacts.OffError):
            openfoodfacts.fetch_product(
                CODE, base_url="https://off.test", contact="c", opener=opener
            )


def test_redirects_are_refused() -> None:
    handler = openfoodfacts._NoRedirect()

    with pytest.raises(openfoodfacts.OffError):
        handler.redirect_request(Request("https://off.test/"), None, 302, "Found", {}, "https://x/")


class Calls:
    """Remplaçant de `fetch_product` : compte les appels, rend la réponse prévue."""

    def __init__(self, result: openfoodfacts.OffProduct | Exception | None) -> None:
        self.result = result
        self.count = 0

    def __call__(self, code: str) -> openfoodfacts.OffProduct | None:
        self.count += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def test_a_scanned_product_is_kept_and_served_from_the_local_copy() -> None:
    fetch = Calls(product())

    food = services.lookup_barcode(owner=someone(), code=CODE, fetch=fetch)
    again = services.lookup_barcode(owner=someone(), code=CODE, fetch=fetch)

    assert fetch.count == 1
    assert again.pk == food.pk
    assert (food.source, food.source_code, food.owner_id) == (FoodSource.OFF, CODE, None)


def test_a_stale_copy_is_refreshed_or_served_when_off_fails() -> None:
    services.lookup_barcode(owner=someone(), code=CODE, fetch=Calls(product()))
    Food.objects.update(fetched_at=timezone.now() - timedelta(days=31))

    refreshed = services.lookup_barcode(
        owner=someone(), code=CODE, fetch=Calls(product(product_name_fr="Nouveau"))
    )
    assert refreshed.name == "Nouveau"

    Food.objects.update(fetched_at=timezone.now() - timedelta(days=31))
    served = services.lookup_barcode(
        owner=someone(), code=CODE, fetch=Calls(openfoodfacts.OffError("panne"))
    )
    assert served.name == "Nouveau"


def test_absence_is_remembered_and_failures_without_copy_are_busy() -> None:
    missing = Calls(None)
    for _ in range(2):
        with pytest.raises(services.BarcodeNotFoundError):
            services.lookup_barcode(owner=someone(), code=CODE, fetch=missing)
    assert missing.count == 1

    with pytest.raises(services.OffBusyError):
        services.lookup_barcode(
            owner=someone(), code="3017624010701", fetch=Calls(openfoodfacts.OffError("x"))
        )
    with pytest.raises(services.BarcodeUnusableError):
        services.lookup_barcode(
            owner=someone(), code="96385074", fetch=Calls(openfoodfacts.UnusableProductError())
        )
    with pytest.raises(services.BarcodeNotFoundError):
        services.lookup_barcode(owner=someone(), code="123", fetch=Calls(product()))


def test_off_calls_are_capped_for_the_whole_application(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "OFF_CALLS_PER_MINUTE", 1)
    fetch = Calls(product())
    services.lookup_barcode(owner=someone(), code=CODE, fetch=fetch)

    with pytest.raises(services.OffBusyError):
        services.lookup_barcode(owner=someone(), code="3017624010701", fetch=fetch)
    assert fetch.count == 1


class Athlete:
    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def get(self, path: str) -> Any:
        return self.client.get(f"/api/v1/foods/{path}", headers=self.headers)

    def put(self, food_id: object, body: dict[str, Any]) -> Any:
        return self.client.put(
            f"/api/v1/foods/{food_id}/", body, content_type="application/json", headers=self.headers
        )

    def delete(self, food_id: object) -> Any:
        return self.client.delete(f"/api/v1/foods/{food_id}/", headers=self.headers)


@pytest.mark.parametrize(
    ("result", "status"),
    [
        (None, 404),
        (openfoodfacts.UnusableProductError(), 422),
        (openfoodfacts.OffError("panne"), 503),
    ],
)
def test_the_barcode_route_maps_each_outcome(
    monkeypatch: pytest.MonkeyPatch, result: Any, status: int
) -> None:
    monkeypatch.setattr(openfoodfacts, "fetch_product", lambda *a, **k: Calls(result)(CODE))

    response = Athlete().get(f"barcode/{CODE}/")

    assert response.status_code == status
    assert response["Content-Type"] == "application/problem+json"


def test_the_barcode_route_returns_the_food(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(openfoodfacts, "fetch_product", lambda *a, **k: product())

    body = Athlete().get(f"barcode/{CODE}/").json()

    assert (body["source"], body["name"], body["brand"], body["serving_g"]) == (
        "off",
        "Barre témoin protéinée",
        "Marque témoin",
        40.0,
    )
    # Mention exigée par l'ODbL : lien vers la fiche publique du produit.
    assert body["source_url"] == f"https://world.openfoodfacts.org/product/{CODE}"


@override_settings(ACCOUNT_RATE_LIMITS={"food_lookup": "1/m/user"})
def test_scans_are_rate_limited_per_account(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(openfoodfacts, "fetch_product", lambda *a, **k: product())
    me = Athlete()

    assert me.get(f"barcode/{CODE}/").status_code == 200
    assert me.get(f"barcode/{CODE}/").status_code == 429


CUSTOM = {"name": " Gâteau maison ", "kcal_100g": "350.5", "protein_100g": 6, "serving_g": 80}


def test_custom_foods_are_created_replaced_searched_and_deleted() -> None:
    me = Athlete()
    food_id = uuid4()

    created = me.put(food_id, CUSTOM)
    replaced = me.put(food_id, {**CUSTOM, "kcal_100g": 360})

    assert created.status_code == 201
    assert created.json()["name"] == "Gâteau maison"
    assert created.json()["is_custom"] is True
    assert replaced.status_code == 200
    assert [f["kcal_100g"] for f in me.get("?q=gateau").json()] == [360.0]
    assert me.delete(food_id).status_code == 204
    assert me.delete(food_id).status_code == 204
    assert me.get("?q=gateau").json() == []


def test_custom_foods_are_private_and_shared_foods_cannot_be_changed() -> None:
    me, other = Athlete(), Athlete()
    food_id = uuid4()
    me.put(food_id, CUSTOM)
    shared = Food.objects.create(
        source=FoodSource.CIQUAL, source_code="1", name="Ciqual", kcal_100g=1
    )

    assert other.put(food_id, CUSTOM).status_code == 404
    assert other.delete(food_id).status_code == 204
    assert other.get("?q=gateau").json() == []
    assert me.put(shared.id, CUSTOM).status_code == 404
    assert me.delete(shared.id).status_code == 204
    assert Food.objects.filter(pk=shared.id).exists()
    assert Food.objects.get(pk=food_id).owner_id == me.user.pk


@pytest.mark.parametrize(
    "body",
    [
        {**CUSTOM, "name": "   "},
        {**CUSTOM, "name": "Nom\u0000nul"},
        {**CUSTOM, "kcal_100g": 901},
        {**CUSTOM, "protein_100g": 101},
        {**CUSTOM, "serving_g": 0},
        {**CUSTOM, "kcal_100g": "12.34"},
    ],
)
def test_an_invalid_custom_food_is_refused(body: dict[str, Any]) -> None:
    assert Athlete().put(uuid4(), body).status_code == 422


def test_custom_food_ids_must_be_client_v4_uuids_and_are_capped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    me = Athlete()
    assert me.put(uuid1(), CUSTOM).status_code == 422
    monkeypatch.setattr(services, "MAX_CUSTOM_FOODS", 1)
    me.put(uuid4(), CUSTOM)

    refused = me.put(uuid4(), CUSTOM)

    assert refused.status_code == 422
    assert refused.json()["errors"] == [{"loc": ["food_id"], "type": "too_many"}]


def test_off_text_is_stripped_of_control_and_format_characters() -> None:
    found = product(
        product_name_fr="\u202eBarre\u0000 témoin\u200b  protéinée\n",
        brands="Marque\u0007 témoin, Autre",
    )

    assert (found.name, found.brand) == ("Barre témoin protéinée", "Marque témoin")
    with pytest.raises(openfoodfacts.UnusableProductError):
        openfoodfacts.parse_product(CODE, answer(product_name_fr="\u0000\u202e", product_name=None))


def test_one_account_cannot_use_up_the_off_quota(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "OFF_CALLS_PER_ACCOUNT_MINUTE", 1)
    greedy, other = make_verified_user(), make_verified_user()
    fetch = Calls(product())
    services.lookup_barcode(owner=greedy, code=CODE, fetch=fetch)

    with pytest.raises(services.OffQuotaError):
        services.lookup_barcode(owner=greedy, code="3017624010701", fetch=fetch)
    services.lookup_barcode(owner=other, code="3017624010701", fetch=fetch)
    # Une copie locale ne compte pas : le compte gourmand la lit encore.
    assert services.lookup_barcode(owner=greedy, code=CODE, fetch=fetch).source_code == CODE
    assert fetch.count == 2


def test_an_unusable_product_is_remembered() -> None:
    unusable = Calls(openfoodfacts.UnusableProductError())
    for _ in range(2):
        with pytest.raises(services.BarcodeUnusableError):
            services.lookup_barcode(owner=someone(), code=CODE, fetch=unusable)
    assert unusable.count == 1


def test_the_daily_account_share_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "OFF_CALLS_PER_ACCOUNT_DAY", 1)
    me = make_verified_user()
    services.lookup_barcode(owner=me, code=CODE, fetch=Calls(product()))

    with pytest.raises(services.OffQuotaError):
        services.lookup_barcode(owner=me, code="3017624010701", fetch=Calls(product()))


def test_an_off_failure_is_remembered_for_a_minute() -> None:
    failing = Calls(openfoodfacts.OffError("panne"))
    for _ in range(2):
        with pytest.raises(services.OffBusyError):
            services.lookup_barcode(owner=someone(), code=CODE, fetch=failing)
    assert failing.count == 1


def test_a_product_removed_from_off_keeps_its_local_copy() -> None:
    services.lookup_barcode(owner=someone(), code=CODE, fetch=Calls(product()))
    Food.objects.update(fetched_at=timezone.now() - timedelta(days=31))
    gone = Calls(None)

    first = services.lookup_barcode(owner=someone(), code=CODE, fetch=gone)
    second = services.lookup_barcode(owner=someone(), code=CODE, fetch=gone)

    assert first.name == second.name == "Barre témoin protéinée"
    assert gone.count == 1


def test_the_barcode_route_answers_429_when_the_account_share_is_spent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(services, "OFF_CALLS_PER_ACCOUNT_MINUTE", 0)

    assert Athlete().get(f"barcode/{CODE}/").status_code == 429
