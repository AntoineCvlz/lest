"""Journal des repas et eau (ADR 0010) : chiffrés, aliment recopié à la saisie, totaux du jour,
aliments récents, isolation entre comptes."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, get_args
from uuid import uuid1, uuid4

import pytest
from django.core.exceptions import ValidationError
from django.db import connection
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.nutrition import selectors, services
from apps.nutrition.api.router import MealName
from apps.nutrition.models import Food, FoodSource, JournalEntry, Meal, WaterIntake
from common.fields import TEXT_BLOCK

pytestmark = pytest.mark.django_db

DAY = date(2026, 10, 1)


def shared_food(name: str = "Riz témoin, cuit", kcal: str = "150", **values: Any) -> Food:
    return Food.objects.create(
        source=FoodSource.CIQUAL,
        source_code=str(uuid4().int)[:8],
        name=name,
        kcal_100g=Decimal(kcal),
        protein_100g=values.get("protein", Decimal("3.0")),
        carbs_100g=values.get("carbs", Decimal("32.0")),
        fat_100g=values.get("fat"),
    )


def eat(owner: User, food: Food, grams: str = "200", **overrides: Any) -> JournalEntry:
    entry, _ = services.put_entry(
        owner=owner,
        entry_id=overrides.get("entry_id", uuid4()),
        day=overrides.get("day", DAY),
        meal=overrides.get("meal", Meal.LUNCH),
        food_id=food.pk,
        grams=Decimal(grams),
    )
    return entry


# Colonnes lues telles qu'en base (requêtes fixes, aucune construite).
RAW = {
    "name": "SELECT name FROM nutrition_journalentry WHERE id = %s",
    "grams": "SELECT grams FROM nutrition_journalentry WHERE id = %s",
    "food_ref": "SELECT food_ref FROM nutrition_journalentry WHERE id = %s",
}


def raw(column: str, entry: JournalEntry) -> str:
    with connection.cursor() as cursor:
        cursor.execute(RAW[column], [entry.pk])
        value: str = cursor.fetchone()[0]
    return value


def test_the_api_meals_match_the_model() -> None:
    assert set(get_args(MealName)) == set(Meal.values)


def test_an_entry_is_encrypted_at_rest_with_padded_names() -> None:
    user = make_verified_user()
    short = eat(user, shared_food("Riz"))
    longer = eat(user, shared_food("Riz témoin cuit sans sel ajouté, variété longue"))

    assert "Riz" not in raw("name", short)
    assert "200" not in raw("grams", short)
    assert str(short.food_ref) not in raw("food_ref", short)
    # Même bloc de 64 octets : la longueur du jeton ne distingue pas les deux noms.
    assert len("Riz témoin cuit sans sel ajouté, variété longue".encode()) < TEXT_BLOCK
    assert len(raw("name", short)) == len(raw("name", longer))
    assert JournalEntry.objects.get(pk=short.pk).name == "Riz"


def test_the_food_is_copied_and_values_scale_with_grams() -> None:
    user = make_verified_user()
    food = shared_food(fat=None)
    entry = eat(user, food, grams="150")

    food.kcal_100g = Decimal(999 % 900)
    food.name = "Autre nom"
    food.save()
    view = selectors.day_journal(owner=user, day=DAY).entries[0]

    assert (view.name, view.grams, view.kcal, view.protein, view.carbs, view.fat) == (
        "Riz témoin, cuit",
        Decimal("150.0"),
        Decimal("225.0"),
        Decimal("4.5"),
        Decimal("48.0"),
        Decimal("0.0"),
    )
    assert view.food_id == str(food.pk)
    assert view.id == entry.pk


def test_changing_the_quantity_keeps_the_copy_changing_the_food_takes_a_new_one() -> None:
    user = make_verified_user()
    rice, chicken = shared_food(), shared_food("Poulet témoin", kcal="165")
    entry_id = uuid4()
    eat(user, rice, entry_id=entry_id)
    rice.kcal_100g = Decimal(100)
    rice.save()

    eat(user, rice, grams="100", entry_id=entry_id, meal=Meal.DINNER)
    kept = selectors.day_journal(owner=user, day=DAY).entries[0]
    eat(user, chicken, grams="100", entry_id=entry_id)
    changed = selectors.day_journal(owner=user, day=DAY).entries[0]

    assert (kept.meal, kept.kcal) == (Meal.DINNER, Decimal("150.0"))
    assert (changed.name, changed.kcal) == ("Poulet témoin", Decimal("165.0"))
    assert JournalEntry.objects.count() == 1


def test_a_deleted_custom_food_stays_readable_in_the_journal() -> None:
    user = make_verified_user()
    cake, _ = services.put_custom_food(
        owner=user,
        food_id=uuid4(),
        values=services.CustomFoodValues(
            name="Gâteau maison",
            brand="",
            kcal_100g=Decimal(350),
            protein_100g=None,
            carbs_100g=None,
            fat_100g=None,
            serving_g=None,
        ),
    )
    eat(user, cake, grams="80")
    services.delete_custom_food(owner=user, food_id=cake.pk)

    journal = selectors.day_journal(owner=user, day=DAY)

    assert [(e.name, e.kcal) for e in journal.entries] == [("Gâteau maison", Decimal("280.0"))]
    assert selectors.recent_foods(owner=user) == []


def test_another_accounts_food_or_entry_cannot_be_used() -> None:
    me, other = make_verified_user(), make_verified_user()
    secret, _ = services.put_custom_food(
        owner=other,
        food_id=uuid4(),
        values=services.CustomFoodValues(
            name="Recette secrète",
            brand="",
            kcal_100g=Decimal(100),
            protein_100g=None,
            carbs_100g=None,
            fat_100g=None,
            serving_g=None,
        ),
    )
    with pytest.raises(services.UnknownFoodError):
        eat(me, secret)
    theirs = eat(other, shared_food())
    with pytest.raises(services.NotFoundError):
        eat(me, shared_food(), entry_id=theirs.pk)
    services.delete_entry(owner=me, entry_id=theirs.pk)
    assert JournalEntry.objects.filter(pk=theirs.pk).exists()


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"grams": "0"}, "grams"),
        ({"grams": "5000.1"}, "grams"),
        ({"meal": "brunch"}, "meal"),
        ({"day": date(1999, 12, 31)}, "date"),
    ],
)
def test_an_invalid_entry_is_refused(overrides: dict[str, Any], field: str) -> None:
    user = make_verified_user()
    grams = overrides.pop("grams", "100")

    with pytest.raises(ValidationError) as error:
        eat(user, shared_food(), grams=grams, **overrides)

    assert error.value.message_dict.keys() == {field}


def test_entries_per_day_are_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(services, "MAX_ENTRIES_PER_DAY", 1)
    user = make_verified_user()
    eat(user, shared_food())

    with pytest.raises(ValidationError):
        eat(user, shared_food())
    eat(user, shared_food(), day=DAY + timedelta(days=1))


def test_the_day_totals_and_water_are_computed_per_account() -> None:
    me, other = make_verified_user(), make_verified_user()
    eat(me, shared_food(), grams="200", meal=Meal.LUNCH)
    eat(me, shared_food("Huile témoin", kcal="900", carbs=None, fat=Decimal(100)), grams="10")
    eat(other, shared_food(), grams="500")
    services.put_water(owner=me, day=DAY, ml=1500)
    services.put_water(owner=me, day=DAY, ml=2000)

    journal = selectors.day_journal(owner=me, day=DAY)

    assert len(journal.entries) == 2
    assert journal.totals == selectors.Totals(
        kcal=Decimal("390.0"), protein=Decimal("6.3"), carbs=Decimal("64.0"), fat=Decimal("10.0")
    )
    assert journal.water_ml == 2000
    assert WaterIntake.objects.filter(owner=me).count() == 1
    assert selectors.day_journal(owner=other, day=DAY).water_ml == 0


def test_recent_foods_are_the_latest_distinct_visible_ones() -> None:
    user = make_verified_user()
    rice, chicken, oats = shared_food(), shared_food("Poulet témoin"), shared_food("Avoine")
    eat(user, rice, day=DAY)
    eat(user, chicken, day=DAY + timedelta(days=1))
    eat(user, rice, day=DAY + timedelta(days=2))
    eat(user, oats, day=DAY - timedelta(days=1))
    oats.is_active = False
    oats.save()

    assert [f.name for f in selectors.recent_foods(owner=user)] == [
        "Riz témoin, cuit",
        "Poulet témoin",
    ]
    assert selectors.recent_foods(owner=make_verified_user()) == []


def test_journal_and_water_are_exported_and_deleted_with_the_account() -> None:
    user = make_verified_user()
    eat(user, shared_food(), grams="100", meal=Meal.BREAKFAST)
    services.put_water(owner=user, day=DAY, ml=750)

    exported = export_account(user)

    assert exported["food_journal"] == [
        {
            "date": "2026-10-01",
            "meal": "breakfast",
            "food": "Riz témoin, cuit",
            "grams": 100.0,
            "kcal": 150.0,
            "protein_g": 3.0,
            "carbs_g": 32.0,
            "fat_g": 0.0,
        }
    ]
    assert exported["water"] == [{"date": "2026-10-01", "ml": 750}]
    delete_account(user=user, password=TEST_PASSWORD)
    assert not JournalEntry.objects.exists()
    assert not WaterIntake.objects.exists()


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


def entry_body(food: Food, **overrides: Any) -> dict[str, Any]:
    return {
        "date": "2026-10-01",
        "meal": "lunch",
        "food_id": str(food.pk),
        "grams": 200,
        **overrides,
    }


def test_the_journal_api_writes_reads_and_deletes() -> None:
    me = Athlete()
    food = shared_food()
    entry_id = uuid4()

    created = me.put(f"journal-entries/{entry_id}/", entry_body(food))
    replaced = me.put(f"journal-entries/{entry_id}/", entry_body(food, grams="250.5"))
    me.put("water/2026-10-01/", {"ml": 1250})
    day = me.get("journal/2026-10-01/").json()

    assert created.status_code == 201
    assert created.json()["kcal"] == 300.0
    assert replaced.status_code == 200
    assert day["totals"] == {"kcal": 375.8, "protein": 7.5, "carbs": 80.2, "fat": 0.0}
    assert day["water_ml"] == 1250
    assert [e["id"] for e in day["entries"]] == [str(entry_id)]
    assert [f["name"] for f in me.get("foods/recent/").json()] == ["Riz témoin, cuit"]
    assert me.delete(f"journal-entries/{entry_id}/").status_code == 204
    assert me.delete(f"journal-entries/{entry_id}/").status_code == 204
    assert me.get("journal/2026-10-01/").json()["entries"] == []


def test_the_journal_api_refuses_bad_input_without_echo() -> None:
    me = Athlete()
    food = shared_food()

    unknown = me.put(f"journal-entries/{uuid4()}/", entry_body(food, food_id=str(uuid4())))
    assert unknown.status_code == 422
    assert unknown.json()["type"] == "urn:lest:problem:unknown-reference"
    assert me.put(f"journal-entries/{uuid1()}/", entry_body(food)).status_code == 422
    bad = me.put(f"journal-entries/{uuid4()}/", entry_body(food, grams="123.45"))
    assert bad.status_code == 422
    assert "123.45" not in bad.content.decode()
    assert me.put("water/2026-10-01/", {"ml": 10001}).status_code == 422
    assert me.put("water/2026-10-01/", {"ml": "500"}).status_code == 422


def test_another_account_never_reads_my_journal(client: Client) -> None:
    me, other = Athlete(), Athlete()
    entry_id = uuid4()
    me.put(f"journal-entries/{entry_id}/", entry_body(shared_food()))

    assert other.get("journal/2026-10-01/").json()["entries"] == []
    assert other.put(f"journal-entries/{entry_id}/", entry_body(shared_food())).status_code == 404
    assert client.get("/api/v1/journal/2026-10-01/").status_code == 401


@override_settings(ACCOUNT_RATE_LIMITS={"nutrition_write": "1/m/user"})
def test_journal_writes_share_the_nutrition_rate_limit() -> None:
    me = Athlete()
    food = shared_food()

    assert me.put(f"journal-entries/{uuid4()}/", entry_body(food)).status_code == 201
    assert me.put("water/2026-10-01/", {"ml": 500}).status_code == 429


def test_today_is_accepted_tomorrow_too_but_not_later() -> None:
    me = Athlete()
    food = shared_food()
    today = timezone.localdate()

    for offset, status in ((0, 201), (1, 201), (2, 422)):
        day = (today + timedelta(days=offset)).isoformat()
        assert (
            me.put(f"journal-entries/{uuid4()}/", entry_body(food, date=day)).status_code == status
        )


def test_an_inactive_food_cannot_be_added() -> None:
    food = shared_food()
    food.is_active = False
    food.save()

    with pytest.raises(services.UnknownFoodError):
        eat(make_verified_user(), food)


def test_recent_foods_decrypt_only_the_food_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    from common import crypto

    user = make_verified_user()
    for _ in range(3):
        eat(user, shared_food())
    calls = 0
    decrypt = crypto.decrypt

    def counting(token: str) -> str:
        nonlocal calls
        calls += 1
        return decrypt(token)

    monkeypatch.setattr(crypto, "decrypt", counting)
    selectors.recent_foods(owner=user)

    assert calls == 3
