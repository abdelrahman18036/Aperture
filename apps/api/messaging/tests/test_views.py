"""Tests for `messaging.views`.

The HTTP surface, including the two things a browser depends on and cannot
work around: snowflake ids that survive the round trip as strings, and a
`client_id` retry that returns the original message instead of a second one.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from messaging import selectors, services
from messaging.models import Conversation
from users.models import Block, User

pytestmark = pytest.mark.django_db


@pytest.fixture
def conversation(user: User, other_user: User) -> Conversation:
    return services.start_dm(initiator=user, other=other_user)


def send_via_api(api: APIClient, conversation: Conversation, **body: Any) -> Any:
    payload = {"client_id": str(uuid.uuid4()), "body": "hello", **body}
    return api.post(
        f"/api/messaging/conversations/{conversation.pk}/messages",
        payload,
        format="json",
    )


# ---------------------------------------------------------------------------
# Authentication and membership
# ---------------------------------------------------------------------------


def test_every_messaging_endpoint_requires_a_session(
    api: APIClient, conversation: Conversation
) -> None:
    assert api.get("/api/messaging/conversations").status_code == 403
    assert (
        api.get(f"/api/messaging/conversations/{conversation.pk}/messages").status_code
        == 403
    )
    assert api.post("/api/realtime/ticket").status_code == 403


def test_an_outsider_gets_404_not_403(
    api: APIClient, conversation: Conversation
) -> None:
    """403 would confirm the conversation exists — an enumeration oracle."""
    outsider = User.objects.create_user(
        "nosy@example.com", "nosy", "correct-horse-staple"
    )
    api.force_authenticate(user=outsider)

    read = api.get(f"/api/messaging/conversations/{conversation.pk}/messages")
    assert read.status_code == 404

    write = send_via_api(api, conversation)
    assert write.status_code == 404


def test_a_conversation_that_does_not_exist_answers_the_same_way(
    signed_in: APIClient,
) -> None:
    """Identical response, so the two cases cannot be told apart."""
    response = signed_in.get("/api/messaging/conversations/80000000000000000/messages")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Snowflake ids cross the wire as strings
# ---------------------------------------------------------------------------


def test_ids_are_strings_and_survive_the_round_trip(
    signed_in: APIClient, conversation: Conversation
) -> None:
    """Above 2^53 a snowflake loses precision in JavaScript's `Number`.

    `JSON.parse` would silently round it, and the id sent back would address a
    different row. Hence `SnowflakeField` and the `<snowflake:>` converter.
    """
    assert conversation.pk > 2**53

    response = send_via_api(signed_in, conversation)
    assert response.status_code == 201

    message = response.json()["message"]
    assert isinstance(message["id"], str)
    assert isinstance(message["conversation_id"], str)
    assert message["conversation_id"] == str(conversation.pk)
    # `seq` stays a number on purpose: small, dense, per conversation.
    assert isinstance(message["seq"], int)

    # And the string id addresses the same row it names.
    listed = signed_in.get(
        f"/api/messaging/conversations/{message['conversation_id']}/messages"
    )
    assert listed.status_code == 200
    assert listed.json()["messages"][0]["id"] == message["id"]


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


def test_send_returns_the_message_and_created_true(
    signed_in: APIClient, conversation: Conversation
) -> None:
    response = send_via_api(signed_in, conversation, body="first")
    assert response.status_code == 201
    assert response.json()["created"] is True
    assert response.json()["message"]["body"] == "first"
    assert response.json()["message"]["seq"] == 1


def test_retrying_with_the_same_client_id_returns_the_original(
    signed_in: APIClient, conversation: Conversation
) -> None:
    """The retry path, end to end over HTTP.

    A timeout the client did not see is indistinguishable from a failure, so
    it retries. This must not produce two messages.
    """
    client_id = str(uuid.uuid4())
    first = send_via_api(signed_in, conversation, client_id=client_id, body="once")
    second = send_via_api(signed_in, conversation, client_id=client_id, body="once")

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["created"] is True
    assert second.json()["created"] is False
    assert first.json()["message"]["id"] == second.json()["message"]["id"]

    listed = signed_in.get(
        f"/api/messaging/conversations/{conversation.pk}/messages"
    ).json()
    assert len(listed["messages"]) == 1


def test_a_missing_client_id_is_rejected(
    signed_in: APIClient, conversation: Conversation
) -> None:
    """No server-side default: a client without idempotency should notice."""
    response = signed_in.post(
        f"/api/messaging/conversations/{conversation.pk}/messages",
        {"body": "no id"},
        format="json",
    )
    assert response.status_code == 400


def test_an_empty_message_is_rejected(
    signed_in: APIClient, conversation: Conversation
) -> None:
    response = send_via_api(signed_in, conversation, body="")
    assert response.status_code == 400


def test_a_blocked_dm_becomes_indistinguishable_from_one_that_never_existed(
    signed_in: APIClient, user: User, other_user: User, conversation: Conversation
) -> None:
    """404 on every verb, and no `detail` to read anything out of.

    This used to answer 400 "that account is unavailable", which is a worse
    answer than it looks: a 400 confirms the conversation is there. Filtering
    the block at the selector rather than the service means the thread is
    simply not the caller's any more, and the endpoints cannot say anything
    else — see `01-ARCHITECTURE.md` §11, which names DMs.
    """
    Block.objects.create(blocker=other_user, blocked=user)

    assert send_via_api(signed_in, conversation).status_code == 404
    assert (
        signed_in.get(
            f"/api/messaging/conversations/{conversation.pk}/messages"
        ).status_code
        == 404
    )
    assert (
        signed_in.post(
            f"/api/messaging/conversations/{conversation.pk}/read",
            {"up_to_seq": 1},
            format="json",
        ).status_code
        == 404
    )
    # And identical to a conversation id nobody has ever used.
    absent = signed_in.get("/api/messaging/conversations/80000000000000000/messages")
    real = signed_in.get(f"/api/messaging/conversations/{conversation.pk}/messages")
    assert absent.status_code == real.status_code
    assert absent.json() == real.json()


def test_a_blocked_dm_leaves_the_inbox_over_http(
    signed_in: APIClient, user: User, other_user: User, conversation: Conversation
) -> None:
    assert len(signed_in.get("/api/messaging/conversations").json()) == 1

    Block.objects.create(blocker=user, blocked=other_user)

    assert signed_in.get("/api/messaging/conversations").json() == []


def test_a_group_keeps_working_when_one_member_blocks_you(
    signed_in: APIClient, user: User, other_user: User
) -> None:
    """The read path filters that person's messages, not the whole thread."""
    third = User.objects.create_user("third@example.com", "third", "correct-horse-x")
    group = services.start_group(
        initiator=user, others=[other_user, third], title="Darkroom"
    )
    for sender, body in ((other_user, "from them"), (third, "from third")):
        services.send_message(
            sender=sender,
            conversation=group,
            client_id=str(uuid.uuid4()),
            body=body,
        )

    Block.objects.create(blocker=user, blocked=other_user)

    page = signed_in.get(f"/api/messaging/conversations/{group.pk}/messages")
    assert page.status_code == 200
    assert [m["body"] for m in page.json()["messages"]] == ["from third"]
    assert len(signed_in.get("/api/messaging/conversations").json()) == 1


def test_media_belonging_to_someone_else_is_refused(
    signed_in: APIClient, conversation: Conversation, other_user: User
) -> None:
    """Attaching by id must not let anyone attach any media they can name."""
    from media.models import Media

    theirs = Media.objects.create(
        owner=other_user,
        kind=Media.Kind.IMAGE,
        state=Media.State.READY,
        bucket="media",
        object_key="theirs.jpg",
        declared_mime="image/jpeg",
        declared_size_bytes=1000,
    )
    response = send_via_api(signed_in, conversation, media_id=str(theirs.pk))
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Reading — the sync and the scrollback
# ---------------------------------------------------------------------------


def test_after_returns_only_what_was_missed(
    signed_in: APIClient, conversation: Conversation
) -> None:
    """The reconnect call, over HTTP."""
    for index in range(6):
        send_via_api(signed_in, conversation, body=f"m{index}")

    response = signed_in.get(
        f"/api/messaging/conversations/{conversation.pk}/messages?after=4"
    )
    assert response.status_code == 200
    body = response.json()
    assert [m["seq"] for m in body["messages"]] == [5, 6]
    assert body["last_message_seq"] == 6


def test_a_page_is_returned_oldest_first(
    signed_in: APIClient, conversation: Conversation
) -> None:
    """Read the index backwards, hand it back in reading order."""
    for index in range(5):
        send_via_api(signed_in, conversation, body=f"m{index}")

    body = signed_in.get(
        f"/api/messaging/conversations/{conversation.pk}/messages"
    ).json()
    assert [m["seq"] for m in body["messages"]] == [1, 2, 3, 4, 5]
    assert body["oldest_seq"] == 1


def test_before_pages_backwards_through_history(
    signed_in: APIClient, conversation: Conversation
) -> None:
    for index in range(8):
        send_via_api(signed_in, conversation, body=f"m{index}")

    body = signed_in.get(
        f"/api/messaging/conversations/{conversation.pk}/messages?before=4"
    ).json()
    assert [m["seq"] for m in body["messages"]] == [1, 2, 3]


def test_an_empty_conversation_reads_cleanly(
    signed_in: APIClient, conversation: Conversation
) -> None:
    body = signed_in.get(
        f"/api/messaging/conversations/{conversation.pk}/messages"
    ).json()
    assert body["messages"] == []
    assert body["oldest_seq"] is None
    assert body["last_message_seq"] == 0


# ---------------------------------------------------------------------------
# The inbox
# ---------------------------------------------------------------------------


def test_the_inbox_carries_unread_counts(
    signed_in: APIClient, user: User, other_user: User, conversation: Conversation
) -> None:
    for _ in range(3):
        services.send_message(
            sender=other_user,
            conversation=conversation,
            client_id=str(uuid.uuid4()),
            body="from them",
        )

    inbox = signed_in.get("/api/messaging/conversations").json()
    assert len(inbox) == 1
    assert inbox[0]["unread_count"] == 3
    assert inbox[0]["id"] == str(conversation.pk)
    assert [m["username"] for m in inbox[0]["members"]] == ["ada"]
    assert inbox[0]["last_message"]["body"] == "from them"


def test_starting_a_dm_twice_returns_the_same_conversation(
    signed_in: APIClient, other_user: User
) -> None:
    first = signed_in.post(
        "/api/messaging/conversations", {"usernames": ["ada"]}, format="json"
    )
    second = signed_in.post(
        "/api/messaging/conversations", {"usernames": ["ada"]}, format="json"
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


def test_starting_a_dm_with_an_unknown_account_is_404(signed_in: APIClient) -> None:
    response = signed_in.post(
        "/api/messaging/conversations", {"usernames": ["ghost"]}, format="json"
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Read receipts and deletion
# ---------------------------------------------------------------------------


def test_marking_read_clears_the_badge(
    signed_in: APIClient, user: User, other_user: User, conversation: Conversation
) -> None:
    for _ in range(4):
        services.send_message(
            sender=other_user,
            conversation=conversation,
            client_id=str(uuid.uuid4()),
            body="unread",
        )

    response = signed_in.post(
        f"/api/messaging/conversations/{conversation.pk}/read",
        {"up_to_seq": 4},
        format="json",
    )
    assert response.status_code == 204
    assert selectors.unread_counts(user=user)[conversation.pk] == 0


def test_deleting_someone_elses_message_is_404(
    signed_in: APIClient, other_user: User, conversation: Conversation
) -> None:
    """Their message, so 404 — the same answer as a message that isn't there."""
    theirs, _ = services.send_message(
        sender=other_user,
        conversation=conversation,
        client_id=str(uuid.uuid4()),
        body="mine",
    )
    response = signed_in.delete(
        f"/api/messaging/conversations/{conversation.pk}/messages/{theirs.seq}"
    )
    assert response.status_code == 404
    theirs.refresh_from_db()
    assert theirs.deleted_at is None


def test_deleting_your_own_message_removes_it_from_the_thread(
    signed_in: APIClient, conversation: Conversation
) -> None:
    sent = send_via_api(signed_in, conversation, body="oops").json()["message"]

    response = signed_in.delete(
        f"/api/messaging/conversations/{conversation.pk}/messages/{sent['seq']}"
    )
    assert response.status_code == 204

    body = signed_in.get(
        f"/api/messaging/conversations/{conversation.pk}/messages"
    ).json()
    assert body["messages"] == []


# ---------------------------------------------------------------------------
# The realtime ticket
# ---------------------------------------------------------------------------


def test_the_ticket_is_short_lived_and_carries_the_url(
    signed_in: APIClient, user: User
) -> None:
    """A credential in a query string is only acceptable because it expires."""
    response = signed_in.post("/api/realtime/ticket")
    assert response.status_code == 200

    body = response.json()
    assert body["expires_in_seconds"] <= 60
    assert body["url"].startswith("ws")
    assert body["ticket"].count(".") == 2  # header.payload.signature


def test_the_ticket_names_its_bearer_and_nobody_else(
    signed_in: APIClient, user: User
) -> None:
    """The gateway derives the socket's channel from this claim alone.

    If `sub` were wrong — or a number that lost precision — a socket would be
    subscribed to somebody else's messages.
    """
    import jwt
    from django.conf import settings

    token = signed_in.post("/api/realtime/ticket").json()["ticket"]
    claims = jwt.decode(token, settings.REALTIME_TICKET_SECRET, algorithms=["HS256"])

    assert claims["sub"] == str(user.pk)
    assert isinstance(claims["sub"], str)
    assert claims["exp"] > claims["iat"]


def test_a_ticket_signed_with_the_wrong_secret_does_not_verify(
    signed_in: APIClient,
) -> None:
    """The shared secret is the whole trust relationship with the gateway."""
    import jwt

    token = signed_in.post("/api/realtime/ticket").json()["ticket"]
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, "a" * 48, algorithms=["HS256"])
