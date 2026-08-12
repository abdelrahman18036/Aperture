"""Tests for `users.views`."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from users.models import User

pytestmark = pytest.mark.django_db


def test_sign_in_with_email_and_password(api: APIClient, user: User) -> None:
    response = api.post(
        "/api/users/session",
        {"email": "marko@example.com", "password": "correct-horse-staple"},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["username"] == "marko"


def test_sign_in_is_case_insensitive_on_the_username_but_uses_email(
    api: APIClient, user: User
) -> None:
    """Email is the credential here; username is only for profile URLs."""
    response = api.post(
        "/api/users/session",
        {"email": "marko@example.com", "password": "wrong"},
        format="json",
    )
    assert response.status_code == 400


def test_a_bad_password_and_an_unknown_email_are_indistinguishable(
    api: APIClient, user: User
) -> None:
    """Otherwise this endpoint is an account-enumeration oracle."""
    wrong_password = api.post(
        "/api/users/session",
        {"email": "marko@example.com", "password": "wrong"},
        format="json",
    )
    unknown_email = api.post(
        "/api/users/session",
        {"email": "nobody@example.com", "password": "wrong"},
        format="json",
    )
    assert wrong_password.status_code == unknown_email.status_code == 400
    assert wrong_password.json() == unknown_email.json()


def test_me_is_forbidden_when_signed_out(api: APIClient) -> None:
    assert api.get("/api/users/me").status_code == 403


def test_me_returns_the_signed_in_user(signed_in: APIClient) -> None:
    response = signed_in.get("/api/users/me")
    assert response.status_code == 200
    assert response.json()["email"] == "marko@example.com"


def test_the_public_user_shape_carries_no_email(
    signed_in: APIClient, user: User
) -> None:
    from users.serializers import UserSerializer

    assert "email" not in UserSerializer(user).data


def test_sign_out_is_idempotent(api: APIClient) -> None:
    assert api.delete("/api/users/session").status_code == 204
    assert api.delete("/api/users/session").status_code == 204


def test_ids_cross_the_wire_as_strings(signed_in: APIClient) -> None:
    body = signed_in.get("/api/users/me").json()
    assert isinstance(body["id"], str)
    assert int(body["id"]) > 2**53


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def test_registering_creates_an_account_and_signs_it_in(api: APIClient) -> None:
    """Signed in as part of registering, not as a separate step afterwards."""
    response = api.post(
        "/api/users/register",
        {
            "email": "new@example.com",
            "username": "newcomer",
            "password": "correct-horse-staple",
        },
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["username"] == "newcomer"

    # The session is live: the next request already knows who this is.
    assert api.get("/api/users/me").json()["username"] == "newcomer"


def test_a_taken_username_is_named(api: APIClient, user: User) -> None:
    """A username is public and enumerable anyway, so saying so costs nothing
    and not saying so costs the person a guessing game."""
    response = api.post(
        "/api/users/register",
        {
            "email": "other@example.com",
            "username": "marko",
            "password": "correct-horse-staple",
        },
        format="json",
    )
    assert response.status_code == 400
    assert "username" in response.json()["detail"].lower()


def test_a_taken_email_is_not_named(api: APIClient, user: User) -> None:
    """`start_session` is careful not to be an enumeration oracle, and an
    endpoint beside it that confirms which emails are registered undoes that."""
    response = api.post(
        "/api/users/register",
        {
            "email": "marko@example.com",
            "username": "someoneelse",
            "password": "correct-horse-staple",
        },
        format="json",
    )
    assert response.status_code == 400
    detail = response.json()["detail"].lower()
    assert "email" not in detail
    assert "registered" not in detail
    assert "taken" not in detail


def test_a_weak_password_is_refused(api: APIClient) -> None:
    """Django's validators already know about common passwords. Inventing a
    second rule here would only be a worse copy of them."""
    response = api.post(
        "/api/users/register",
        {"email": "weak@example.com", "username": "weakling", "password": "password"},
        format="json",
    )
    assert response.status_code == 400


def test_a_username_that_cannot_be_a_url_is_refused(api: APIClient) -> None:
    """Profiles live at `/u/<username>`, so a name that cannot be linked to
    cannot be chosen."""
    for bad in ("has space", "sla/sh", "qu?ery", "em@il"):
        response = api.post(
            "/api/users/register",
            {
                "email": f"{abs(hash(bad))}@example.com",
                "username": bad,
                "password": "correct-horse-staple",
            },
            format="json",
        )
        assert response.status_code == 400, bad


def test_follow_requests_paginate_by_cursor(signed_in: APIClient, user: User) -> None:
    """One screenful at a time, walked by cursor rather than by offset.

    An offset would skip rows: requests are answered while the list is open,
    everything below slides up, and page two starts past whatever moved.
    """
    from users.models import Follow
    from users.selectors import REQUEST_PAGE_SIZE

    user.is_private = True
    user.save(update_fields=["is_private"])

    total = REQUEST_PAGE_SIZE + 5
    for index in range(total):
        follower = User.objects.create_user(
            email=f"asker{index}@example.com",
            username=f"asker{index}",
            password="correct-horse-staple",
        )
        Follow.objects.create(
            follower=follower, followee=user, status=Follow.Status.PENDING
        )

    first = signed_in.get("/api/users/requests").json()
    assert len(first["requests"]) == REQUEST_PAGE_SIZE
    assert first["next_cursor"] is not None

    second = signed_in.get(f"/api/users/requests?cursor={first['next_cursor']}").json()
    assert len(second["requests"]) == 5
    # The end of the list says so, rather than handing back a cursor that
    # returns nothing.
    assert second["next_cursor"] is None

    # And no row appears on both pages.
    names = [
        row["follower"]["username"] for row in first["requests"] + second["requests"]
    ]
    assert len(names) == len(set(names)) == total
