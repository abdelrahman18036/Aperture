"""Tests for `messaging.selectors`.

The reconnect sync is the point of this file. `messages_after` is what a
client calls when its socket comes back, and if it is wrong the failure mode
is silent: a gap nobody notices until someone mentions a message that was
never displayed.
"""

from __future__ import annotations

import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from messaging import selectors, services
from messaging.models import Conversation
from users.models import Block, User


@pytest.fixture
def alice(db: object) -> User:
    return User.objects.create_user("sel-a@example.com", "sel-a", "pw-sel-12345")


@pytest.fixture
def bob(db: object) -> User:
    return User.objects.create_user("sel-b@example.com", "sel-b", "pw-sel-12345")


@pytest.fixture
def conversation(alice: User, bob: User) -> Conversation:
    return services.start_dm(initiator=alice, other=bob)


def send(sender: User, conversation: Conversation, body: str = "hello") -> int:
    message, _ = services.send_message(
        sender=sender,
        conversation=conversation,
        client_id=str(uuid.uuid4()),
        body=body,
    )
    return message.seq


# ---------------------------------------------------------------------------
# The reconnect sync
# ---------------------------------------------------------------------------


def test_messages_after_returns_only_newer_in_order(
    alice: User, conversation: Conversation
) -> None:
    for index in range(10):
        send(alice, conversation, f"m{index}")

    window = list(selectors.messages_after(conversation=conversation, after_seq=6))

    assert [m.seq for m in window] == [7, 8, 9, 10]


def test_messages_after_zero_is_the_whole_conversation(
    alice: User, conversation: Conversation
) -> None:
    """A client with no cursor asks for everything after 0."""
    for _ in range(4):
        send(alice, conversation)

    window = list(selectors.messages_after(conversation=conversation, after_seq=0))
    assert [m.seq for m in window] == [1, 2, 3, 4]


def test_messages_after_the_end_is_empty_not_an_error(
    alice: User, conversation: Conversation
) -> None:
    """The common case on reconnect: nothing was missed."""
    send(alice, conversation)
    assert list(selectors.messages_after(conversation=conversation, after_seq=1)) == []
    # And a cursor from the future — a stale client, or a restored backup —
    # must return nothing rather than blow up.
    assert (
        list(selectors.messages_after(conversation=conversation, after_seq=9_999)) == []
    )


def test_the_sync_leaves_no_gap_around_a_deleted_message(
    alice: User, conversation: Conversation
) -> None:
    """Deleted messages are skipped, and that must not shift anything else.

    The client's cursor is a `seq`, so a sync that renumbered around a deletion
    would desynchronise every client that had already seen past it.
    """
    seqs = [send(alice, conversation, f"m{i}") for i in range(5)]
    target = selectors.message_by_seq(conversation=conversation, seq=seqs[2])
    assert target is not None
    services.soft_delete_message(actor=alice, message=target)

    window = list(selectors.messages_after(conversation=conversation, after_seq=0))
    assert [m.seq for m in window] == [1, 2, 4, 5]


def test_messages_after_is_capped(alice: User, conversation: Conversation) -> None:
    """A client three days behind must not be able to ask for everything."""
    for _ in range(12):
        send(alice, conversation)

    window = list(
        selectors.messages_after(conversation=conversation, after_seq=0, limit=5)
    )
    assert len(window) == 5

    huge = list(
        selectors.messages_after(conversation=conversation, after_seq=0, limit=10_000)
    )
    assert len(huge) <= selectors.MAX_PAGE_SIZE


def test_the_sync_does_not_n_plus_one(alice: User, conversation: Conversation) -> None:
    """Rule 10. The sender and media joins must be in the same query.

    Without `select_related`, rendering a fifty-message sync costs a hundred
    extra queries — the specific thing the ORM hides best.
    """
    for _ in range(20):
        send(alice, conversation)

    with CaptureQueriesContext(connection) as captured:
        window = list(selectors.messages_after(conversation=conversation, after_seq=0))
        for message in window:
            # Touching the relations is what would trigger the extra queries.
            _ = message.sender.username
            _ = message.media

    assert len(window) == 20
    assert len(captured) == 1, [q["sql"] for q in captured]


# ---------------------------------------------------------------------------
# Scrollback
# ---------------------------------------------------------------------------


def test_messages_before_walks_backwards(
    alice: User, conversation: Conversation
) -> None:
    for _ in range(10):
        send(alice, conversation)

    page = list(
        selectors.messages_before(conversation=conversation, before_seq=6, limit=3)
    )
    assert [m.seq for m in page] == [5, 4, 3]


def test_messages_before_without_a_cursor_starts_at_the_end(
    alice: User, conversation: Conversation
) -> None:
    """Opening a thread shows the newest messages, not the oldest."""
    for _ in range(10):
        send(alice, conversation)

    page = list(selectors.messages_before(conversation=conversation, limit=3))
    assert [m.seq for m in page] == [10, 9, 8]


# ---------------------------------------------------------------------------
# Unread — by subtraction, never by COUNT (rule 9)
# ---------------------------------------------------------------------------


def test_unread_is_the_difference_between_two_columns(
    alice: User, bob: User, conversation: Conversation
) -> None:
    for _ in range(7):
        send(bob, conversation)

    assert selectors.unread_counts(user=alice)[conversation.pk] == 7
    # The sender has read their own messages by definition.
    assert selectors.unread_counts(user=bob)[conversation.pk] == 0

    member = selectors.membership_or_none(user=alice, conversation_id=conversation.pk)
    assert member is not None
    services.mark_read(member=member, up_to_seq=5)

    assert selectors.unread_counts(user=alice)[conversation.pk] == 2


def test_unread_never_goes_negative(
    alice: User, bob: User, conversation: Conversation
) -> None:
    """Defensive, because a negative badge is a visible bug and cheap to prevent."""
    send(bob, conversation)
    member = selectors.membership_or_none(user=alice, conversation_id=conversation.pk)
    assert member is not None
    member.last_read_seq = 500
    member.save(update_fields=["last_read_seq"])

    assert selectors.unread_counts(user=alice)[conversation.pk] == 0


def test_unread_issues_no_count_query(
    alice: User, bob: User, conversation: Conversation
) -> None:
    """Rule 9, asserted against the SQL rather than trusted.

    No `COUNT(` anywhere, however many queries it takes — the rule is about
    counting rows, not about round trips.

    Two queries, not one: the block list is materialised first, which
    `users.selectors.blocked_ids` argues for explicitly — block lists are
    short, so one small query beats a correlated subquery evaluated per row.
    """
    for _ in range(5):
        send(bob, conversation)

    with CaptureQueriesContext(connection) as captured:
        selectors.unread_counts(user=alice)

    assert len(captured) <= 2
    for query in captured:
        assert "COUNT(" not in query["sql"].upper()


# ---------------------------------------------------------------------------
# Membership is the access control
# ---------------------------------------------------------------------------


def test_membership_is_none_for_an_outsider(conversation: Conversation) -> None:
    """The whole read-side authorization story, in one selector."""
    outsider = User.objects.create_user("out@example.com", "out", "pw-out-123456")
    assert (
        selectors.membership_or_none(user=outsider, conversation_id=conversation.pk)
        is None
    )


def test_inbox_orders_by_most_recent_activity(alice: User, bob: User) -> None:
    carol = User.objects.create_user("sel-c@example.com", "sel-c", "pw-sel-12345")
    first = services.start_dm(initiator=alice, other=bob)
    second = services.start_dm(initiator=alice, other=carol)

    send(alice, first)
    send(alice, second)
    send(alice, second)

    inbox = list(selectors.inbox(alice))
    # Most messages, hence highest last_message_seq, hence top.
    assert inbox[0].conversation_id == second.pk
    assert inbox[1].conversation_id == first.pk


# ---------------------------------------------------------------------------
# Blocking — 01-ARCHITECTURE.md §11 names DMs explicitly
# ---------------------------------------------------------------------------


def test_a_blocked_dm_leaves_the_inbox(
    alice: User, bob: User, conversation: Conversation
) -> None:
    """The whole point of blocking somebody you have a history with."""
    send(bob, conversation)
    assert len(list(selectors.inbox(alice))) == 1

    Block.objects.create(blocker=alice, blocked=bob)

    assert list(selectors.inbox(alice)) == []
    assert selectors.unread_counts(user=alice) == {}


def test_a_blocked_dm_disappears_for_the_blocked_account_too(
    alice: User, bob: User, conversation: Conversation
) -> None:
    """One-directional hiding is what makes blocking feel useless.

    If only the blocker stops seeing the thread, the blocked account keeps
    reading everything and simply cannot reply.
    """
    send(alice, conversation)
    Block.objects.create(blocker=alice, blocked=bob)

    assert list(selectors.inbox(bob)) == []
    assert (
        selectors.membership_or_none(user=bob, conversation_id=conversation.pk) is None
    )


def test_a_blocked_dm_cannot_be_opened_or_rung(
    alice: User, bob: User, conversation: Conversation
) -> None:
    """`membership_or_none` is the choke point every caller goes through.

    Messages, read receipts and calls all resolve a conversation through it,
    so filtering here is what makes one change cover all of them.
    """
    from calls.selectors import callable_conversation

    Block.objects.create(blocker=bob, blocked=alice)

    assert (
        selectors.membership_or_none(user=alice, conversation_id=conversation.pk)
        is None
    )
    assert callable_conversation(user=alice, conversation_id=conversation.pk) is None


def test_a_group_survives_a_block_minus_that_person(alice: User, bob: User) -> None:
    """Losing thirty people because one of them blocked you is the block
    acting on the wrong target."""
    carol = User.objects.create_user("sel-d@example.com", "sel-d", "pw-sel-12345")
    group = services.start_group(initiator=alice, others=[bob, carol])

    send(bob, group, "from bob")
    send(carol, group, "from carol")
    send(alice, group, "from alice")

    Block.objects.create(blocker=alice, blocked=bob)

    # Still in the inbox.
    assert [m.conversation_id for m in selectors.inbox(alice)] == [group.pk]

    bodies = [
        m.body
        for m in selectors.messages_after(conversation=group, after_seq=0, viewer=alice)
    ]
    assert bodies == ["from carol", "from alice"]


def test_scrollback_filters_blocked_senders_too(alice: User, bob: User) -> None:
    """Both directions of the same index, or the block only half works."""
    carol = User.objects.create_user("sel-e@example.com", "sel-e", "pw-sel-12345")
    group = services.start_group(initiator=alice, others=[bob, carol])

    send(bob, group, "from bob")
    send(carol, group, "from carol")

    Block.objects.create(blocker=carol, blocked=bob)

    bodies = [
        m.body for m in selectors.messages_before(conversation=group, viewer=carol)
    ]
    assert bodies == ["from carol"]


def test_no_viewer_means_no_filtering(alice: User, bob: User) -> None:
    """The selectors are also called where there is no viewer to filter for.

    Defaulting to unfiltered is safe *only* because every request path passes
    one — which the view tests assert separately.
    """
    group = services.start_group(initiator=alice, others=[bob])
    send(bob, group, "from bob")
    Block.objects.create(blocker=alice, blocked=bob)

    unfiltered = list(selectors.messages_after(conversation=group, after_seq=0))
    assert [m.body for m in unfiltered] == ["from bob"]
