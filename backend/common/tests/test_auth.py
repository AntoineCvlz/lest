import pytest
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from apps.accounts.tests.factories import make_user
from common.auth import request_user

pytestmark = pytest.mark.django_db


def test_returns_the_user_authenticated_by_the_jwt(rf: RequestFactory) -> None:
    user = make_user()
    request = rf.get("/")
    request.user = user
    request.auth = {"sub": str(user.pk)}  # type: ignore[attr-defined]

    assert request_user(request) == user


@pytest.mark.parametrize("auth", [None, {}, {"sub": "00000000-0000-0000-0000-000000000000"}])
def test_a_session_user_without_a_matching_jwt_is_refused(
    rf: RequestFactory, auth: dict[str, str] | None
) -> None:
    request = rf.get("/")
    request.user = make_user()  # comme le ferait le cookie de session de l'admin
    if auth is not None:
        request.auth = auth  # type: ignore[attr-defined]

    with pytest.raises(TypeError):
        request_user(request)


def test_an_anonymous_user_is_refused(rf: RequestFactory) -> None:
    request = rf.get("/")
    request.user = AnonymousUser()

    with pytest.raises(TypeError):
        request_user(request)
