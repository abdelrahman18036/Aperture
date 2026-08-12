"""Tests for `calls.views`.

The HTTP surface. What matters here is that a browser cannot talk its way
into a call: not by naming someone else's conversation, not by replaying a
call id, and not by asking for a mode it prefers.
"""

from __future__ import annotations

from typing import Any

import pytest
from rest_framework.test import APIClient

from messaging import services as messaging_services
from messaging.models import Conversation
from users.models import Block, User

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_ringing(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    from calls import events

    published: list[dict[str, Any]] = []
    monkeypatch.setattr(
        events, "publish_invite", lambda **kwargs: published.append(kwargs)
    )
    return published


@pytest.fixture
def dm(user: User, other_user: User) -> Conversation:
    return messaging_services.start_dm(initiator=user, other=other_user)


def test_starting_a_call_requires_a_session(api: APIClient, dm: Conversation) -> None:
    response = api.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    )
    assert response.status_code == 403


def test_starting_a_call_returns_everything_needed_to_place_it(
    signed_in: APIClient, dm: Conversation
) -> None:
    response = signed_in.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    )
    assert response.status_code == 201

    body = response.json()
    assert body["mode"] == "p2p"
    assert body["conversation_id"] == str(dm.pk)
    assert len(body["ice_servers"]) >= 1
    assert body["livekit_token"] is None


def test_ids_cross_the_wire_as_strings(signed_in: APIClient, dm: Conversation) -> None:
    """A call id above 2^53 that `JSON.parse` rounds names the wrong channel.

    Signalling rides on `call.{id}`, so a rounded id means two clients
    listening to different channels and a call that never connects.
    """
    body = signed_in.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    ).json()

    assert isinstance(body["id"], str)
    assert isinstance(body["conversation_id"], str)
    assert int(body["id"]) > 2**53
    assert all(isinstance(pk, str) for pk in body["participant_ids"])


def test_a_conversation_you_are_not_in_is_404(api: APIClient, dm: Conversation) -> None:
    """404, not 403 — otherwise this endpoint enumerates private threads."""
    outsider = User.objects.create_user(
        "outsider@example.com", "outsider", "correct-horse-staple"
    )
    api.force_authenticate(user=outsider)

    response = api.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    )
    assert response.status_code == 404


def test_a_conversation_that_does_not_exist_answers_identically(
    signed_in: APIClient,
) -> None:
    response = signed_in.post(
        "/api/calls/start", {"conversation_id": "80000000000000000"}, format="json"
    )
    assert response.status_code == 404


def test_a_block_is_400_and_says_nothing(
    signed_in: APIClient, user: User, other_user: User, dm: Conversation
) -> None:
    Block.objects.create(blocker=other_user, blocked=user)

    response = signed_in.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    )
    assert response.status_code == 400
    assert "block" not in response.json()["detail"].lower()


def test_joining_a_call_in_someone_elses_conversation_is_404(
    api: APIClient, signed_in: APIClient, dm: Conversation
) -> None:
    """The call id is a capability, but the conversation is still checked.

    A leaked id must not be enough on its own.
    """
    started = signed_in.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    ).json()

    outsider = User.objects.create_user(
        "gatecrash@example.com", "gatecrash", "correct-horse-staple"
    )
    api.force_authenticate(user=outsider)

    response = api.post(
        "/api/calls/join",
        {
            "conversation_id": str(dm.pk),
            "call_id": started["id"],
            "mode": "p2p",
        },
        format="json",
    )
    assert response.status_code == 404


def test_joining_returns_your_own_credentials(
    api: APIClient, signed_in: APIClient, other_user: User, dm: Conversation
) -> None:
    started = signed_in.post(
        "/api/calls/start", {"conversation_id": str(dm.pk)}, format="json"
    ).json()

    api.force_authenticate(user=other_user)
    joined = api.post(
        "/api/calls/join",
        {
            "conversation_id": str(dm.pk),
            "call_id": started["id"],
            "mode": "p2p",
        },
        format="json",
    )
    assert joined.status_code == 200

    body = joined.json()
    assert body["id"] == started["id"]

    def username(payload: dict[str, Any]) -> str:
        for server in payload["ice_servers"]:
            if "username" in server:
                return str(server["username"])
        raise AssertionError("no TURN credential returned")

    assert username(body).endswith(f":{other_user.pk}")
    assert username(body) != username(started)


def test_an_unknown_mode_is_rejected(signed_in: APIClient, dm: Conversation) -> None:
    """The server decides the mode; the client only echoes what it was told."""
    response = signed_in.post(
        "/api/calls/join",
        {
            "conversation_id": str(dm.pk),
            "call_id": "80000000000000001",
            "mode": "mesh-of-thirty",
        },
        format="json",
    )
    assert response.status_code == 400


def test_the_other_party_is_rung(
    signed_in: APIClient,
    other_user: User,
    dm: Conversation,
    _no_ringing: list[dict[str, Any]],
) -> None:
    signed_in.post("/api/calls/start", {"conversation_id": str(dm.pk)}, format="json")

    assert len(_no_ringing) == 1
    assert _no_ringing[0]["recipient_ids"] == [other_user.pk]
