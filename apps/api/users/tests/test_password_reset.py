"""Tests for password reset.

The interesting properties here are all negative ones — what the endpoint
declines to tell you, and what stops working after a reset. Those are the
parts that are easy to regress while the happy path keeps passing.
"""

from __future__ import annotations

import re

import pytest
from django.core import mail
from rest_framework.test import APIClient

from users.models import User

pytestmark = pytest.mark.django_db

NEW_PASSWORD = "a-completely-different-one"


def link_parts(body: object) -> tuple[str, str]:
    """Pull `uid` and `token` back out of the mailed link.

    Parsed rather than generated, so the test exercises the same string a
    person would click. A link the browser cannot use fails here too.
    """
    # `body` is typed `str | _StrPromise` by django-stubs, because a mail
    # body may be a lazy translation. Resolving it is what `str()` is for.
    match = re.search(r"/reset/([^/\s]+)/([^/\s]+)", str(body))
    assert match is not None, body
    return match.group(1), match.group(2)


def request_reset(api: APIClient, email: str) -> None:
    response = api.post("/api/users/password/reset", {"email": email}, format="json")
    assert response.status_code == 204


def test_a_reset_link_actually_works(api: APIClient, user: User) -> None:
    request_reset(api, user.email)
    uid, token = link_parts(mail.outbox[0].body)

    response = api.post(
        "/api/users/password/reset/confirm",
        {"uid": uid, "token": token, "password": NEW_PASSWORD},
        format="json",
    )
    assert response.status_code == 204

    signed_in = api.post(
        "/api/users/session",
        {"email": user.email, "password": NEW_PASSWORD},
        format="json",
    )
    assert signed_in.status_code == 200


def test_the_old_password_stops_working(api: APIClient, user: User) -> None:
    request_reset(api, user.email)
    uid, token = link_parts(mail.outbox[0].body)
    api.post(
        "/api/users/password/reset/confirm",
        {"uid": uid, "token": token, "password": NEW_PASSWORD},
        format="json",
    )

    response = api.post(
        "/api/users/session",
        {"email": user.email, "password": "correct-horse-staple"},
        format="json",
    )
    assert response.status_code == 400


def test_an_unknown_address_is_indistinguishable_from_a_known_one(
    api: APIClient, user: User
) -> None:
    # The whole reason this endpoint answers 204 unconditionally. A different
    # status, or a different body, and it is a way to test whether an address
    # has an account here without holding any credential at all.
    known = api.post("/api/users/password/reset", {"email": user.email}, format="json")
    unknown = api.post(
        "/api/users/password/reset", {"email": "nobody@example.com"}, format="json"
    )

    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content
    # And no mail was sent for the address that does not exist.
    assert len(mail.outbox) == 1


def test_a_link_works_once(api: APIClient, user: User) -> None:
    request_reset(api, user.email)
    uid, token = link_parts(mail.outbox[0].body)
    body = {"uid": uid, "token": token, "password": NEW_PASSWORD}

    assert (
        api.post("/api/users/password/reset/confirm", body, format="json").status_code
        == 204
    )
    # Nothing revokes it explicitly. The token is an HMAC over the password
    # hash, so changing the password is what invalidates it — which is why
    # there is no token table to forget to clean up.
    assert (
        api.post("/api/users/password/reset/confirm", body, format="json").status_code
        == 400
    )


def test_a_tampered_token_is_refused(api: APIClient, user: User) -> None:
    request_reset(api, user.email)
    uid, token = link_parts(mail.outbox[0].body)

    response = api.post(
        "/api/users/password/reset/confirm",
        {"uid": uid, "token": token[:-1] + "x", "password": NEW_PASSWORD},
        format="json",
    )
    assert response.status_code == 400


def test_a_malformed_uid_does_not_raise(api: APIClient) -> None:
    # `urlsafe_base64_decode` throws on junk. Unhandled it is a 500, which is
    # a self-inflicted alert on an endpoint anyone can reach.
    response = api.post(
        "/api/users/password/reset/confirm",
        {"uid": "not-base64!!", "token": "whatever", "password": NEW_PASSWORD},
        format="json",
    )
    assert response.status_code == 400


def test_a_weak_password_is_refused_with_a_reason(api: APIClient, user: User) -> None:
    request_reset(api, user.email)
    uid, token = link_parts(mail.outbox[0].body)

    response = api.post(
        "/api/users/password/reset/confirm",
        {"uid": uid, "token": token, "password": "12345"},
        format="json",
    )
    assert response.status_code == 400
    # Validators run on this path as well as on registration. Reset is the
    # easy place to end up with a second, laxer set of password rules.
    assert "too short" in response.json()["detail"].lower()


def test_a_deleted_account_gets_no_link(api: APIClient, user: User) -> None:
    user.deleted_at = user.created_at
    user.is_active = False
    user.save(update_fields=["deleted_at", "is_active"])

    request_reset(api, user.email)
    assert mail.outbox == []
