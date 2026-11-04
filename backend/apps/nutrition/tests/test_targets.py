"""Objectifs nutritionnels (ADR 0011) : Mifflin-St Jeor, activité, objectif du profil, macros."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from django.test import Client

from apps.accounts.models import Goal, User
from apps.accounts.selectors import export_account
from apps.accounts.services import delete_account, save_profile
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import TEST_PASSWORD, make_verified_user
from apps.body.services import put_weight
from apps.nutrition import targets
from apps.nutrition.models import NutritionTarget

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 4)


def inputs(**overrides: Any) -> targets.Inputs:
    values: dict[str, Any] = {
        "sex": "male",
        "birth_date": date(1996, 11, 4),
        "activity": "moderate",
        "weight_kg": Decimal(80),
        "height_m": Decimal("1.80"),
        "goal": Goal.MAINTAIN,
        **overrides,
    }
    return targets.Inputs(**values)


def test_age_counts_full_years() -> None:
    assert targets.age(date(1996, 11, 4), TODAY) == 30
    assert targets.age(date(1996, 11, 5), TODAY) == 29


def test_mifflin_st_jeor_for_each_sex() -> None:
    # 10 x 80 + 6,25 x 180 - 5 x 30 + 5 = 1 780 ; -161 pour la formule féminine.
    assert targets.basal_kcal(inputs(), today=TODAY) == Decimal(1780)
    assert targets.basal_kcal(inputs(sex="female"), today=TODAY) == Decimal(1614)


@pytest.mark.parametrize(
    ("goal", "activity", "kcal", "protein", "fat", "carbs"),
    [
        # 1 780 x 1,55 = 2 759 → 2 760 ; protéines 160 g, lipides 72 g, glucides le reste.
        (Goal.MAINTAIN, "moderate", 2760, 160, 72, 368),
        # + 10 % en prise de masse : 3 034,9 → 3 030.
        (Goal.GAIN, "moderate", 3030, 160, 72, 436),
        # - 20 % en sèche, sédentaire : 1 780 x 1,2 x 0,8 = 1 708,8 → 1 710.
        (Goal.CUT, "sedentary", 1710, 160, 72, 106),
    ],
)
def test_targets_follow_activity_goal_and_weight(
    goal: str, activity: str, kcal: int, protein: int, fat: int, carbs: int
) -> None:
    computed = targets.compute(inputs(goal=goal, activity=activity), today=TODAY)

    assert computed == targets.Targets(kcal=kcal, protein_g=protein, carbs_g=carbs, fat_g=fat)


def test_carbs_never_go_negative() -> None:
    computed = targets.compute(
        inputs(
            weight_kg=Decimal(150), height_m=Decimal("1.50"), goal=Goal.CUT, activity="sedentary"
        ),
        today=TODAY,
    )
    assert computed.carbs_g == 0


class Athlete:
    def __init__(self, *, profile: bool = True, weight: bool = True) -> None:
        self.user: User = make_verified_user()
        if profile:
            save_profile(user=self.user, height_m=1.8, goal=Goal.GAIN, unit_system="metric")
        if weight:
            put_weight(owner=self.user, day=date(2026, 11, 1), weight_kg=Decimal(80))
        self.client = Client()
        self.headers = bearer(login(self.client, self.user.email)["access_token"])

    def get(self) -> Any:
        return self.client.get("/api/v1/nutrition/targets/", headers=self.headers)

    def put(self, body: dict[str, Any]) -> Any:
        return self.client.put(
            "/api/v1/nutrition/targets/",
            body,
            content_type="application/json",
            headers=self.headers,
        )


BODY = {"sex": "male", "birth_date": "1996-11-04", "activity": "moderate"}


def test_targets_are_not_configured_until_asked() -> None:
    me = Athlete()

    body = me.get().json()

    assert body["configured"] is False
    assert body["targets"] is None


def test_configured_targets_are_computed_and_can_be_overridden() -> None:
    me = Athlete()

    computed = me.put(BODY)
    assert computed.status_code == 200
    assert computed.json()["computed"]["kcal"] == 3030
    assert computed.json()["targets"] == computed.json()["computed"]
    assert computed.json()["missing"] == []

    overridden = me.put({**BODY, "kcal": 3200, "protein_g": 180})
    assert overridden.json()["targets"]["kcal"] == 3200
    assert overridden.json()["targets"]["protein_g"] == 180
    # Valeur non surchargée : toujours celle du calcul.
    assert overridden.json()["targets"]["fat_g"] == computed.json()["computed"]["fat_g"]
    assert me.get().json()["inputs"] == {
        **BODY,
        "kcal": 3200,
        "protein_g": 180,
        "carbs_g": None,
        "fat_g": None,
    }


def test_missing_weight_or_profile_is_reported() -> None:
    me = Athlete(weight=False)

    body = me.put(BODY).json()

    assert body["computed"] is None
    assert body["missing"] == ["weight"]
    assert Athlete(profile=False).put(BODY).json()["missing"] == ["profile"]


def test_manual_targets_work_without_weight() -> None:
    me = Athlete(weight=False)

    body = me.put({**BODY, "kcal": 2500, "protein_g": 150, "carbs_g": 300, "fat_g": 70}).json()

    assert body["targets"] == {"kcal": 2500, "protein_g": 150, "carbs_g": 300, "fat_g": 70}


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "sex": "autre"},
        {**BODY, "activity": "extreme"},
        {**BODY, "birth_date": "1900-01-01"},
        {**BODY, "birth_date": "2020-01-01"},
        {**BODY, "kcal": 500},
        {**BODY, "protein_g": 600},
    ],
)
def test_invalid_inputs_are_refused(body: dict[str, Any]) -> None:
    assert Athlete().put(body).status_code == 422


def test_inputs_are_encrypted_exported_and_deleted_with_the_account() -> None:
    me = Athlete()
    me.put(BODY)
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("SELECT birth_date, sex FROM nutrition_nutritiontarget")
        birth, sex = cursor.fetchone()
    assert "1996" not in birth
    assert "male" not in sex
    assert export_account(me.user)["nutrition_target"]["birth_date"] == "1996-11-04"
    delete_account(user=me.user, password=TEST_PASSWORD)
    assert not NutritionTarget.objects.exists()


def test_targets_are_private(client: Client) -> None:
    me, other = Athlete(), Athlete()
    me.put(BODY)

    assert other.get().json()["configured"] is False
    assert client.get("/api/v1/nutrition/targets/").status_code == 401
