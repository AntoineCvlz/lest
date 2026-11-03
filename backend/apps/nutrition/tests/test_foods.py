"""Aliments (ADR 0009) : lecture de Ciqual, import rejouable, recherche locale, isolation."""

import io
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.request import Request

import pytest
from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction
from django.test import Client

from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.nutrition import ciqual, selectors, services
from apps.nutrition.models import Food, FoodSource

pytestmark = pytest.mark.django_db

FIXTURES = Path(__file__).parent / "fixtures"
ALIM = (FIXTURES / "alim.xml").read_bytes()
COMPO = (FIXTURES / "compo.xml").read_bytes()


def import_fixture() -> services.ImportReport:
    return services.import_foods(foods=ciqual.parse_foods(ALIM, COMPO))


def custom(owner: Any, name: str) -> Food:
    return Food.objects.create(
        source=FoodSource.CUSTOM, owner=owner, name=name, kcal_100g=Decimal(100)
    )


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (" 5,3 ", Decimal("5.3")),
        ("151", Decimal(151)),
        ("traces", Decimal(0)),
        ("< 0,5", Decimal(0)),
        (" - ", None),
        ("", None),
    ],
)
def test_ciqual_amounts_are_read_with_their_conventions(
    text: str, expected: Decimal | None
) -> None:
    assert ciqual.parse_amount(text) == expected


@pytest.mark.parametrize("text", ["abc", "-5", "NaN"])
def test_an_unreadable_amount_is_refused(text: str) -> None:
    with pytest.raises(ciqual.CiqualError):
        ciqual.parse_amount(text)


def test_foods_are_parsed_and_those_without_energy_are_skipped() -> None:
    foods = {food.code: food for food in ciqual.parse_foods(ALIM, COMPO)}

    assert set(foods) == {"90001", "90002", "90003"}
    pasta = foods["90001"]
    assert (pasta.name, pasta.kcal, pasta.protein, pasta.carbs, pasta.fat) == (
        "Pâtes témoin, cuites",
        Decimal(151),
        Decimal("5.3"),
        Decimal("30.1"),
        Decimal(0),
    )
    assert foods["90002"].carbs == Decimal(0)
    assert foods["90003"].protein is None
    assert foods["90003"].fat is None


def test_xml_with_entities_is_refused() -> None:
    bomb = b'<?xml version="1.0"?><!DOCTYPE t [<!ENTITY a "aaaa">]><TABLE><ALIM>&a;</ALIM></TABLE>'

    with pytest.raises(ciqual.CiqualError):
        ciqual.parse_foods(bomb, COMPO)


class FakeResponse(io.BytesIO):
    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def test_a_file_is_fetched_over_https_only_and_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def opener(request: Request, *, timeout: int) -> FakeResponse:
        seen.append(request.full_url)
        return FakeResponse(b"<TABLE/>")

    assert ciqual.fetch_file("https://exemple.test/datafile/", 42, opener=opener) == b"<TABLE/>"
    assert seen == ["https://exemple.test/datafile/42"]
    with pytest.raises(ciqual.CiqualError):
        ciqual.fetch_file("http://exemple.test/datafile", 42, opener=opener)
    monkeypatch.setattr(ciqual, "MAX_BYTES", 3)
    with pytest.raises(ciqual.CiqualError):
        ciqual.fetch_file("https://exemple.test/datafile", 42, opener=opener)


@pytest.mark.parametrize(
    ("target", "allowed"),
    [
        ("https://prod-espace-generique.opens3r-tls.stockage.inrae.fr/fichier", True),
        ("http://prod-espace-generique.opens3r-tls.stockage.inrae.fr/fichier", False),
        ("https://stockage.inrae.fr.attaquant.test/fichier", False),
        ("https://169.254.169.254/latest/meta-data", False),
    ],
)
def test_only_a_redirect_to_the_inrae_storage_is_followed(target: str, allowed: bool) -> None:
    handler = ciqual._StorageRedirectOnly()
    request = Request("https://entrepot.recherche.data.gouv.fr/api/access/datafile/1")

    if allowed:
        assert handler.redirect_request(request, None, 303, "See Other", {}, target) is not None
    else:
        with pytest.raises(ciqual.CiqualError):
            handler.redirect_request(request, None, 303, "See Other", {}, target)


def test_the_import_is_replayable_and_deactivates_removed_foods() -> None:
    first = import_fixture()
    again = import_fixture()
    removed = services.import_foods(foods=ciqual.parse_foods(ALIM, COMPO)[:2])

    assert (first.created, first.updated, first.deactivated) == (3, 0, 0)
    assert (again.created, again.updated) == (0, 3)
    assert removed.deactivated == 1
    assert Food.objects.filter(source=FoodSource.CIQUAL).count() == 3
    assert not Food.objects.get(source_code="90003").is_active


def test_an_empty_table_changes_nothing() -> None:
    import_fixture()

    with pytest.raises(services.EmptyTableError):
        services.import_foods(foods=[])
    assert Food.objects.filter(is_active=True).count() == 3


def test_the_command_imports_local_files_and_refuses_a_concurrent_import() -> None:
    out = io.StringIO()
    call_command(
        "import_foods", alim=FIXTURES / "alim.xml", compo=FIXTURES / "compo.xml", stdout=out
    )
    assert "3 créés" in out.getvalue()

    with services.import_lock(), pytest.raises(CommandError):
        call_command("import_foods", alim=FIXTURES / "alim.xml", compo=FIXTURES / "compo.xml")
    with pytest.raises(CommandError):
        call_command("import_foods", alim=FIXTURES / "alim.xml")


def test_search_ignores_accents_and_ranks_names_starting_with_the_term_first() -> None:
    import_fixture()
    user = make_verified_user()

    names = [food.name for food in selectors.search_foods(owner=user, query="pates")]

    assert names == ["Pâtes témoin, cuites", "Salade de pâtes témoin"]
    assert [f.name for f in selectors.search_foods(owner=user, query="poulet rôti")] == [
        "Poulet témoin, rôti"
    ]
    assert selectors.search_foods(owner=user, query="   ") == []


def test_search_skips_inactive_foods_and_other_accounts_custom_foods() -> None:
    import_fixture()
    services.import_foods(foods=ciqual.parse_foods(ALIM, COMPO)[:2])
    me, other = make_verified_user(), make_verified_user()
    custom(me, "Pâtes de ma mère")
    custom(other, "Pâtes de sa mère")

    names = {food.name for food in selectors.search_foods(owner=me, query="pâtes")}

    assert names == {"Pâtes témoin, cuites", "Pâtes de ma mère"}


def test_a_custom_food_needs_an_owner_and_only_custom_foods_have_one() -> None:
    user = make_verified_user()
    with pytest.raises(IntegrityError), transaction.atomic():
        Food.objects.create(source=FoodSource.CUSTOM, name="Sans propriétaire", kcal_100g=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        Food.objects.create(source=FoodSource.CIQUAL, owner=user, name="Ciqual à moi", kcal_100g=1)


class Athlete:
    def __init__(self) -> None:
        self.user = make_verified_user()
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def get(self, path: str) -> Any:
        return self.client.get(f"/api/v1/foods/{path}", headers=self.headers)


def test_the_api_searches_and_shows_foods() -> None:
    import_fixture()
    me = Athlete()

    found = me.get("?q=poulet").json()
    assert found == [
        {
            "id": found[0]["id"],
            "source": "ciqual",
            "name": "Poulet témoin, rôti",
            "brand": "",
            "kcal_100g": 165.0,
            "protein_100g": 27.4,
            "carbs_100g": 0.0,
            "fat_100g": 6.2,
            "serving_g": None,
            "is_custom": False,
        }
    ]
    assert me.get(f"{found[0]['id']}/").json()["name"] == "Poulet témoin, rôti"
    assert me.get("?q=p").status_code == 422


def test_another_accounts_custom_food_is_not_found_and_auth_is_required(client: Client) -> None:
    me = Athlete()
    secret = custom(make_verified_user(), "Recette secrète")

    assert me.get(f"{secret.id}/").status_code == 404
    assert client.get("/api/v1/foods/?q=pates").status_code == 401


def test_custom_foods_are_exported_and_deleted_with_the_account() -> None:
    from apps.accounts.selectors import export_account
    from apps.accounts.services import delete_account
    from apps.accounts.tests.factories import TEST_PASSWORD

    user = make_verified_user()
    custom(user, "Gâteau maison")

    assert export_account(user)["custom_foods"] == [
        {
            "name": "Gâteau maison",
            "brand": "",
            "kcal_100g": 100.0,
            "protein_100g": None,
            "carbs_100g": None,
            "fat_100g": None,
            "serving_g": None,
        }
    ]
    delete_account(user=user, password=TEST_PASSWORD)
    assert not Food.objects.filter(source=FoodSource.CUSTOM).exists()


def minimal(code: str, kcal: str = "100", *, twice: bool = False) -> tuple[bytes, bytes]:
    record = f"<ALIM><alim_code>{code}</alim_code><alim_nom_fr>Témoin</alim_nom_fr></ALIM>"
    alim = f"<TABLE>{record}{record if twice else ''}</TABLE>".encode()
    compo = (
        f"<TABLE><COMPO><alim_code>{code}</alim_code><const_code>328</const_code>"
        f"<teneur>{kcal}</teneur></COMPO></TABLE>"
    ).encode()
    return alim, compo


@pytest.mark.parametrize(
    ("alim", "compo"),
    [
        minimal("1" * 33),
        minimal("12\u00b2"),
        minimal("90001", twice=True),
        minimal("90001", kcal="1000"),
    ],
)
def test_a_malformed_source_is_refused_before_the_database(alim: bytes, compo: bytes) -> None:
    with pytest.raises(ciqual.CiqualError):
        ciqual.parse_foods(alim, compo)


def test_control_characters_in_searches_are_refused() -> None:
    me = Athlete()

    assert me.get("?q=ab%00cd").status_code == 422
    exercises = me.client.get("/api/v1/exercises/?q=ab%00cd", headers=me.headers)
    assert exercises.status_code == 422
