"""Tableau de bord (ADR 0013) : poids et rythme, semaines d'activité, adhérence nutrition,
volume par muscle hors échauffement, isolation entre comptes."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from uuid import uuid4

import pytest
from django.test import Client, override_settings
from django.utils import timezone

from apps.accounts.models import Goal, UnitSystem, User
from apps.accounts.services import save_profile
from apps.accounts.tests.auth import bearer, login
from apps.accounts.tests.factories import make_verified_user
from apps.activities import services as activities
from apps.body import services as body
from apps.insights import selectors
from apps.nutrition import services as nutrition
from apps.nutrition.models import Food, FoodSource, Meal
from apps.training import services as training
from apps.training.models import Muscle
from apps.training.tests.factories import make_exercise

pytestmark = pytest.mark.django_db

TODAY = date(2026, 11, 4)  # un mercredi
MONDAY = date(2026, 11, 2)
TARGETS = nutrition.TargetValues(
    sex="male",
    birth_date=date(1996, 5, 12),
    activity="moderate",
    kcal=2000,
    protein_g=100,
    carbs_g=None,
    fat_g=None,
)


def athlete(goal: str = Goal.GAIN) -> User:
    user = make_verified_user()
    save_profile(user=user, height_m=1.8, goal=goal, unit_system=UnitSystem.METRIC)
    return user


def weigh(user: User, day: date, kg: str) -> None:
    body.put_weight(owner=user, day=day, weight_kg=Decimal(kg))


def at(day: date, hour: int) -> datetime:
    return datetime.combine(day, time(hour), tzinfo=timezone.get_current_timezone())


def workout(user: User, day: date, sets: list[tuple[str, int, bool]], exercise: Any) -> None:
    workout_id, item_id = uuid4(), uuid4()
    training.put_workout(
        owner=user, workout_id=workout_id, started_at=at(day, 18), ended_at=at(day, 19)
    )
    training.put_workout_exercise(
        owner=user,
        workout_exercise_id=item_id,
        workout_id=workout_id,
        exercise_id=exercise.pk,
        position=0,
    )
    for position, (kg, reps, warmup) in enumerate(sets):
        training.put_set(
            owner=user,
            set_id=uuid4(),
            workout_exercise_id=item_id,
            position=position,
            weight_kg=Decimal(kg),
            reps=reps,
            rpe=None,
            is_warmup=warmup,
            performed_at=at(day, 18),
        )


@pytest.fixture
def bench() -> Any:
    exercise = make_exercise()
    chest = Muscle.objects.create(code="pectoralis", name="Pectoraux", is_front=True)
    triceps = Muscle.objects.create(code="triceps", name="Triceps", is_front=False)
    exercise.muscles.set([chest, triceps])
    return exercise


# --- Poids -----------------------------------------------------------------------------------


def test_weight_trend_change_and_pace_against_the_goal() -> None:
    user = athlete(Goal.GAIN)
    weigh(user, TODAY - timedelta(days=28), "78.0")
    weigh(user, TODAY, "79.2")

    weight = selectors.dashboard(owner=user, today=TODAY).weight

    assert weight.trend_kg == Decimal("79.20")
    assert weight.change_4w_kg == Decimal("1.20")
    assert weight.change_12w_kg is None
    assert weight.pace_kg_per_week == Decimal("0.30")
    assert (weight.goal, weight.pace_status) == ("gain", "within")


@pytest.mark.parametrize(
    ("goal", "latest", "status"),
    [(Goal.GAIN, "78.0", "below"), (Goal.CUT, "78.4", "above"), (Goal.MAINTAIN, "81.0", "above")],
)
def test_pace_status_follows_the_goal(goal: str, latest: str, status: str) -> None:
    user = athlete(goal)
    weigh(user, TODAY - timedelta(days=28), "78.0")
    weigh(user, TODAY, latest)

    assert selectors.dashboard(owner=user, today=TODAY).weight.pace_status == status


def test_no_weigh_in_means_no_weight_figures() -> None:
    weight = selectors.dashboard(owner=athlete(), today=TODAY).weight

    assert (weight.trend_kg, weight.pace_kg_per_week, weight.pace_status) == (None, None, None)
    assert weight.pace_range == (Decimal("0.1"), Decimal("0.5"))


# --- Semaines et volume ----------------------------------------------------------------------


def test_eight_weeks_of_workouts_and_other_sports(bench: Any) -> None:
    user = athlete()
    workout(user, MONDAY, [("60", 10, False)], bench)
    workout(user, MONDAY - timedelta(days=7), [("60", 10, False)], bench)
    activities.put_activity(
        owner=user,
        activity_id=uuid4(),
        values=activities.ActivityValues(
            day=TODAY, sport="running", duration_s=1800, distance_m=Decimal(5000)
        ),
    )

    weeks = selectors.dashboard(owner=user, today=TODAY).weeks

    assert [w.week for w in weeks][-1] == MONDAY
    assert len(weeks) == selectors.WEEKS
    assert (weeks[-1].workouts, weeks[-1].workout_duration_s) == (1, 3600)
    assert (weeks[-1].activities, weeks[-1].activity_duration_s) == (1, 1800)
    assert weeks[-1].distance_m == Decimal(5000)
    assert weeks[-2].workouts == 1
    assert sum(w.workouts for w in weeks[:-2]) == 0


def test_volume_per_primary_muscle_excludes_warm_up(bench: Any) -> None:
    user = athlete()
    workout(user, MONDAY, [("40", 10, True), ("60", 10, False), ("60", 8, False)], bench)

    muscles = selectors.dashboard(owner=user, today=TODAY).muscles

    assert {(m.muscle, m.sets, m.volume_kg) for m in muscles} == {
        ("Pectoraux", 2, Decimal("1080.00")),
        ("Triceps", 2, Decimal("1080.00")),
    }


def test_an_ongoing_workout_does_not_count(bench: Any) -> None:
    user = athlete()
    training.put_workout(owner=user, workout_id=uuid4(), started_at=at(TODAY, 8), ended_at=None)

    assert selectors.dashboard(owner=user, today=TODAY).weeks[-1].workouts == 0


# --- Nutrition -------------------------------------------------------------------------------


def eat(user: User, day: date, grams: str, food: Food) -> None:
    nutrition.put_entry(
        owner=user,
        entry_id=uuid4(),
        day=day,
        meal=Meal.LUNCH,
        food_id=food.pk,
        grams=Decimal(grams),
    )


def test_adherence_counts_logged_days_before_today() -> None:
    user = athlete()
    # Une pesée : sans elle, des objectifs partiellement saisis ne se calculent pas.
    weigh(user, TODAY, "80")
    nutrition.put_targets(owner=user, values=TARGETS)
    # 400 kcal et 20 g de protéines pour 100 g.
    food = Food.objects.create(
        source=FoodSource.CIQUAL,
        source_code="999",
        name="Aliment témoin",
        kcal_100g=Decimal(400),
        protein_100g=Decimal(20),
    )
    eat(user, TODAY - timedelta(days=1), "500", food)  # 2 000 kcal, 100 g : les deux
    eat(user, TODAY - timedelta(days=2), "400", food)  # 1 600 kcal, 80 g : aucun
    eat(user, TODAY - timedelta(days=10), "550", food)  # 2 200 kcal, 110 g : les deux
    eat(user, TODAY, "500", food)  # journée en cours : exclue

    insight = selectors.dashboard(owner=user, today=TODAY).nutrition

    assert (insight.kcal_target, insight.protein_target) == (2000, 100)
    assert insight.last_7 == selectors.Adherence(7, 2, 1, 1)
    assert insight.last_28 == selectors.Adherence(28, 3, 2, 2)


def test_without_targets_the_block_says_so() -> None:
    insight = selectors.dashboard(owner=athlete(), today=TODAY).nutrition

    assert insight.configured is False
    assert insight.last_7 is None


# --- API et isolation ------------------------------------------------------------------------


def give_a_full_account(user: User, exercise: Any) -> None:
    """Pesée, séance, activité, objectifs et repas d'hier : de quoi remplir chaque bloc."""
    today = timezone.localdate()
    weigh(user, today, "80")
    workout(user, today, [("60", 10, False)], exercise)
    activities.put_activity(
        owner=user,
        activity_id=uuid4(),
        values=activities.ActivityValues(
            day=today, sport="running", duration_s=1800, distance_m=Decimal(5000)
        ),
    )
    nutrition.put_targets(owner=user, values=TARGETS)
    food = Food.objects.create(
        source=FoodSource.CIQUAL,
        source_code=str(uuid4().int)[:8],
        name="Aliment témoin",
        kcal_100g=Decimal(400),
        protein_100g=Decimal(20),
    )
    eat(user, today - timedelta(days=1), "500", food)


def test_b_never_sees_as_figures(client: Client, bench: Any) -> None:
    me, other = athlete(), athlete()
    give_a_full_account(me, bench)
    # B a ses propres objectifs : aucun jour noté ne doit venir de A.
    weigh(other, timezone.localdate() - timedelta(days=40), "70")
    nutrition.put_targets(owner=other, values=TARGETS)
    headers = bearer(login(client, other.email)["access_token"])

    data = client.get("/api/v1/insights/dashboard/", headers=headers).json()

    assert data["weight"]["trend_kg"] == 70.0
    assert data["muscles"] == []
    assert sum(w["workouts"] + w["activities"] for w in data["weeks"]) == 0
    assert sum(w["distance_m"] for w in data["weeks"]) == 0
    assert data["nutrition"]["last_28"]["logged_days"] == 0


def test_the_query_count_does_not_grow_with_the_data(
    bench: Any, django_assert_max_num_queries: Any
) -> None:
    user = athlete()
    workout(user, MONDAY, [("60", 10, False)], bench)
    with django_assert_max_num_queries(20) as small:
        selectors.dashboard(owner=user, today=TODAY)
    for offset in range(1, 30):
        workout(user, MONDAY - timedelta(days=offset), [("60", 10, False)] * 5, bench)

    with django_assert_max_num_queries(len(small.captured_queries)):
        selectors.dashboard(owner=user, today=TODAY)


@override_settings(ACCOUNT_RATE_LIMITS={"insights_read": "2/m/user"})
def test_reads_are_rate_limited(client: Client) -> None:
    headers = bearer(login(client, athlete().email)["access_token"])
    statuses = [
        client.get("/api/v1/insights/dashboard/", headers=headers).status_code for _ in range(3)
    ]

    assert statuses == [200, 200, 429]


def test_the_api_serves_the_dashboard(client: Client, bench: Any) -> None:
    me = athlete()
    today = timezone.localdate()
    weigh(me, today, "80")
    workout(me, today, [("60", 10, False)], bench)
    headers = bearer(login(client, me.email)["access_token"])

    data: dict[str, Any] = client.get("/api/v1/insights/dashboard/", headers=headers).json()

    assert data["weight"]["trend_kg"] == 80.0
    assert data["weight"]["pace_range"] == {"low_kg": 0.1, "high_kg": 0.5}
    assert data["weeks"][-1]["workouts"] == 1
    assert {m["muscle"] for m in data["muscles"]} == {"Pectoraux", "Triceps"}
    assert client.get("/api/v1/insights/dashboard/").status_code == 401
