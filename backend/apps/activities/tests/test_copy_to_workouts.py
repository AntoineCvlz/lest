"""Recopie des activités en séances (ADR 0017) : séance terminée, exercice de cardio de Lest,
une série ; FC et ressenti sur la séance, métriques dans la note ; suivi des modifications et
des suppressions ; commande de rattrapage rejouable ; isolation entre comptes."""

import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import StringIO
from uuid import uuid4

import pytest
from django.core.management import CommandError, call_command
from django.utils import timezone

from apps.accounts.models import User
from apps.accounts.tests.factories import make_verified_user
from apps.activities import services
from apps.activities.models import Activity
from apps.activities.sports import SPORTS
from apps.activities.tests.test_activities import DAY, record
from apps.training.cardio import CARDIO_EXERCISES
from apps.training.models import PersonalRecord, Workout

pytestmark = pytest.mark.django_db


def copy_of(activity: Activity) -> Workout:
    return Workout.objects.get(pk=services.copied_id(activity.pk, "workout"))


def test_every_sport_has_its_lest_exercise() -> None:
    by_key = {item.key: item for item in CARDIO_EXERCISES}

    assert set(by_key) == set(SPORTS)
    for key, sport in SPORTS.items():
        assert (by_key[key].kind == "distance_duration") == sport.has_distance


def test_an_activity_becomes_a_finished_workout() -> None:
    owner = make_verified_user()
    activity = record(
        owner,
        sport="hiking",
        duration_s=5400,
        distance_m=Decimal("12500.5"),
        avg_heart_rate=128,
        feeling=4,
        metrics={"elevation_gain_m": 640},
    )

    workout = copy_of(activity)
    [item] = workout.exercises.select_related("exercise")
    [one] = item.sets.all()

    noon = datetime.combine(DAY, time(12), tzinfo=timezone.get_current_timezone())
    assert (workout.started_at, workout.ended_at) == (noon, noon + timedelta(seconds=5400))
    assert (workout.name, workout.avg_heart_rate, workout.feeling) == (
        "Randonnée",
        Decimal(128),
        Decimal(4),
    )
    assert (item.exercise.source_id, item.note) == ("lest:hiking", "Dénivelé positif : 640 m")
    assert (one.set_type, one.duration_s, one.distance_m) == ("normal", 5400, Decimal("12500.5"))
    assert workout.owner == owner
    assert set(PersonalRecord.objects.filter(owner=owner).values_list("kind", flat=True)) == {
        "distance",
        "duration",
    }


def test_editing_the_activity_rewrites_its_workout_even_across_sports() -> None:
    owner = make_verified_user()
    activity_id = uuid4()
    record(owner, activity_id=activity_id, distance_m=Decimal(5000))

    activity = record(owner, activity_id=activity_id, sport="yoga", duration_s=3600)

    workout = copy_of(activity)
    [item] = workout.exercises.select_related("exercise")
    assert item.exercise.source_id == "lest:yoga"
    assert [(s.duration_s, s.distance_m) for s in item.sets.all()] == [(3600, None)]
    assert Workout.objects.filter(owner=owner).count() == 1


def test_deleting_the_activity_deletes_its_workout_only_for_its_owner() -> None:
    owner, other = make_verified_user(), make_verified_user()
    activity = record(owner)

    services.delete_activity(owner=other, activity_id=activity.pk)
    assert Workout.objects.filter(owner=owner).count() == 1

    services.delete_activity(owner=owner, activity_id=activity.pk)
    assert not Workout.objects.filter(owner=owner).exists()


def legacy(owner: User, day: date) -> Activity:
    """Activité écrite avant la recopie automatique : sans séance."""
    return Activity.objects.create(
        id=uuid4(),
        owner=owner,
        date=day,
        sport="swimming",
        duration_s=Decimal(2400),
        distance_m=None,
        metrics=json.dumps({"laps": 40, "pool_length_m": 25}),
    )


def test_the_command_copies_older_activities_once() -> None:
    owner = make_verified_user()
    old = legacy(owner, DAY)
    record(owner, day=DAY - timedelta(days=1))
    with pytest.raises(CommandError):
        call_command("copy_activities", "--check", stdout=StringIO())

    out = StringIO()
    call_command("copy_activities", stdout=out)
    copied = copy_of(old)
    copied.note = "Modifiée depuis la séance"
    copied.save()
    again = StringIO()
    call_command("copy_activities", stdout=again)

    assert "2 activités, 1 séances recopiées" in out.getvalue()
    assert "2 activités, 0 séances recopiées" in again.getvalue()
    assert copy_of(old).note == "Modifiée depuis la séance"
    [item] = copied.exercises.all()
    assert item.note == "Longueurs : 40\nLongueur du bassin : 25 m"
    call_command("copy_activities", "--check", stdout=StringIO())
