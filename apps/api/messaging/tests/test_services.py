"""Tests for `messaging.services`.

Concentrated on the two invariants `01-ARCHITECTURE.md` §5 calls the most
important lines in the schema: monotonic `seq` and `client_id` idempotency.
Both are cheap to test now and impossible to retrofit onto live conversations,
so they are worth more assertions than the surrounding CRUD.
"""

from __future__ import annotations

import threading
import uuid
from typing import Any

import pytest
from django.db import connections

from messaging import selectors, services
from messaging.models import Conversation, Message
from users.models import Block, User


@pytest.fixture
def alice(db: object) -> User:
    return User.objects.create_user("alice@example.com", "alice", "pw-alice-123")


@pytest.fixture
def bob(db: object) -> User:
    return User.objects.create_user("bob@example.com", "bob", "pw-bob-12345")


@pytest.fixture
def carol(db: object) -> User:
    return User.objects.create_user("carol@example.com", "carol", "pw-carol-123")


def send(sender: User, conversation: Conversation, **kwargs: Any) -> Message:
    message, _ = services.send_message(
        sender=sender,
        conversation=conversation,
        client_id=str(uuid.uuid4()),
        body=kwargs.pop("body", "hello"),
        **kwargs,
    )
    return message


# ---------------------------------------------------------------------------
# Conversation creation
# ---------------------------------------------------------------------------


def test_dm_is_created_once_and_then_reused(alice: User, bob: User) -> None:
    """Two people get exactly one thread forever.

    A second thread would split the history in half with no way to merge it,
    so "message" pressed twice from two screens must land in the same place.
    """
    first = services.start_dm(initiator=alice, other=bob)
    second = services.start_dm(initiator=alice, other=bob)
    assert first.pk == second.pk

    # And from the other side, which is the case an `existing_dm` written with
    # a single-direction filter would get wrong.
    third = services.start_dm(initiator=bob, other=alice)
    assert third.pk == first.pk
    assert Conversation.objects.count() == 1


def test_dm_between_two_pairs_does_not_collide(
    alice: User, bob: User, carol: User
) -> None:
    """`existing_dm` must not match a conversation merely containing one of them."""
    ab = services.start_dm(initiator=alice, other=bob)
    ac = services.start_dm(initiator=alice, other=carol)
    assert ab.pk != ac.pk


def test_cannot_dm_yourself(alice: User) -> None:
    with pytest.raises(services.MessagingRejectedError):
        services.start_dm(initiator=alice, other=alice)


def test_block_prevents_a_dm_in_both_directions(alice: User, bob: User) -> None:
    Block.objects.create(blocker=alice, blocked=bob)

    with pytest.raises(services.MessagingRejectedError):
        services.start_dm(initiator=alice, other=bob)
    # The blocked party must not be able to route around it either.
    with pytest.raises(services.MessagingRejectedError):
        services.start_dm(initiator=bob, other=alice)


def test_block_message_does_not_confirm_the_block(alice: User, bob: User) -> None:
    """Wording is security, not politeness — confirming a block reveals it."""
    Block.objects.create(blocker=alice, blocked=bob)
    with pytest.raises(services.MessagingRejectedError) as caught:
        services.start_dm(initiator=bob, other=alice)
    assert "block" not in str(caught.value).lower()


def test_group_is_capped(alice: User) -> None:
    others = [
        User.objects.create_user(f"m{i}@example.com", f"m{i}", "pw-member-123")
        for i in range(services.MAX_GROUP_MEMBERS)
    ]
    with pytest.raises(services.MessagingRejectedError):
        services.start_group(initiator=alice, others=others)


# ---------------------------------------------------------------------------
# seq — monotonic, gapless, per conversation
# ---------------------------------------------------------------------------


def test_seq_starts_at_one_and_increments(alice: User, bob: User) -> None:
    conversation = services.start_dm(initiator=alice, other=bob)

    seqs = [send(alice, conversation).seq for _ in range(5)]
    assert seqs == [1, 2, 3, 4, 5]

    conversation.refresh_from_db()
    assert conversation.last_message_seq == 5


def test_seq_is_per_conversation_not_global(
    alice: User, bob: User, carol: User
) -> None:
    """Two threads both start at 1. A global sequence would leak volume."""
    ab = services.start_dm(initiator=alice, other=bob)
    ac = services.start_dm(initiator=alice, other=carol)

    assert send(alice, ab).seq == 1
    assert send(alice, ac).seq == 1
    assert send(alice, ab).seq == 2


def test_seq_does_not_come_from_the_clock(alice: User, bob: User) -> None:
    """Ordering must survive two messages inside the same millisecond."""
    conversation = services.start_dm(initiator=alice, other=bob)
    messages = [send(alice, conversation) for _ in range(20)]
    assert [m.seq for m in messages] == list(range(1, 21))
    assert len({m.seq for m in messages}) == 20


@pytest.mark.django_db(transaction=True)
def test_concurrent_sends_do_not_collide_on_seq() -> None:
    """The row lock, tested the only way that means anything: concurrently.

    Without `select_for_update`, two threads read the same
    `last_message_seq`, both write `n + 1`, and the unique constraint on
    `(conversation, seq)` turns one of them into an IntegrityError — or worse,
    without that constraint, into two messages that sort identically forever.

    `transaction=True` because the threads need real committed transactions;
    the default test wrapper would hide the lock entirely.
    """
    alice = User.objects.create_user("conc-a@example.com", "conc-a", "pw-conc-1234")
    bob = User.objects.create_user("conc-b@example.com", "conc-b", "pw-conc-1234")
    conversation = services.start_dm(initiator=alice, other=bob)

    writers = 8
    barrier = threading.Barrier(writers)
    results: list[int] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def write() -> None:
        try:
            barrier.wait(timeout=10)
            message, created = services.send_message(
                sender=alice,
                conversation=conversation,
                client_id=str(uuid.uuid4()),
                body="concurrent",
            )
            with lock:
                results.append(message.seq)
                assert created
        except BaseException as error:
            with lock:
                errors.append(error)
        finally:
            # Each thread gets its own connection; leaking them wedges teardown.
            connections.close_all()

    threads = [threading.Thread(target=write) for _ in range(writers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors, errors
    # Gapless and unique: exactly 1..n, in some interleaving.
    assert sorted(results) == list(range(1, writers + 1))

    conversation.refresh_from_db()
    assert conversation.last_message_seq == writers


# ---------------------------------------------------------------------------
# client_id — idempotency from the constraint, not from a read-then-write
# ---------------------------------------------------------------------------


def test_same_client_id_twice_yields_one_message(alice: User, bob: User) -> None:
    """The retry case. A flaky network must not double-post."""
    conversation = services.start_dm(initiator=alice, other=bob)
    client_id = str(uuid.uuid4())

    first, created_first = services.send_message(
        sender=alice, conversation=conversation, client_id=client_id, body="once"
    )
    second, created_second = services.send_message(
        sender=alice, conversation=conversation, client_id=client_id, body="once"
    )

    assert created_first is True
    assert created_second is False
    assert first.pk == second.pk
    assert first.seq == second.seq
    assert Message.objects.filter(conversation=conversation).count() == 1

    # And the retry must not have burned a sequence number.
    conversation.refresh_from_db()
    assert conversation.last_message_seq == 1


def test_client_id_is_scoped_to_its_conversation(
    alice: User, bob: User, carol: User
) -> None:
    """The constraint is `(conversation, client_id)`, and that matters.

    A client that reuses an id across threads must still get two messages.
    """
    ab = services.start_dm(initiator=alice, other=bob)
    ac = services.start_dm(initiator=alice, other=carol)
    client_id = str(uuid.uuid4())

    _, first = services.send_message(
        sender=alice, conversation=ab, client_id=client_id, body="x"
    )
    _, second = services.send_message(
        sender=alice, conversation=ac, client_id=client_id, body="x"
    )
    assert first is True
    assert second is True


# ---------------------------------------------------------------------------
# Membership, blocks, deletion
# ---------------------------------------------------------------------------


def test_non_member_cannot_send(alice: User, bob: User, carol: User) -> None:
    conversation = services.start_dm(initiator=alice, other=bob)
    with pytest.raises(services.MessagingRejectedError):
        services.send_message(
            sender=carol,
            conversation=conversation,
            client_id=str(uuid.uuid4()),
            body="let me in",
        )


def test_block_after_the_dm_exists_stops_new_messages(alice: User, bob: User) -> None:
    """Blocking has to work on an established thread, not only at creation."""
    conversation = services.start_dm(initiator=alice, other=bob)
    send(alice, conversation)

    Block.objects.create(blocker=bob, blocked=alice)

    with pytest.raises(services.MessagingRejectedError):
        services.send_message(
            sender=alice,
            conversation=conversation,
            client_id=str(uuid.uuid4()),
            body="still here",
        )


def test_empty_message_is_rejected(alice: User, bob: User) -> None:
    conversation = services.start_dm(initiator=alice, other=bob)
    with pytest.raises(services.MessagingRejectedError):
        services.send_message(
            sender=alice, conversation=conversation, client_id=str(uuid.uuid4())
        )


def test_mark_read_moves_forward_only(alice: User, bob: User) -> None:
    """A late-arriving receipt from a slow tab must not un-read anything."""
    conversation = services.start_dm(initiator=alice, other=bob)
    for _ in range(5):
        send(bob, conversation)

    member = selectors.membership_or_none(user=alice, conversation_id=conversation.pk)
    assert member is not None

    services.mark_read(member=member, up_to_seq=4)
    member.refresh_from_db()
    assert member.last_read_seq == 4

    services.mark_read(member=member, up_to_seq=2)
    member.refresh_from_db()
    assert member.last_read_seq == 4


def test_mark_read_is_capped_at_the_high_water_mark(alice: User, bob: User) -> None:
    """A client cannot claim to have read messages that do not exist yet.

    Uncapped, one bad client permanently zeroes its own unread count.
    """
    conversation = services.start_dm(initiator=alice, other=bob)
    send(bob, conversation)

    member = selectors.membership_or_none(user=alice, conversation_id=conversation.pk)
    assert member is not None

    services.mark_read(member=member, up_to_seq=9_999)
    member.refresh_from_db()
    assert member.last_read_seq == 1


def test_delete_is_soft_and_only_by_the_sender(alice: User, bob: User) -> None:
    conversation = services.start_dm(initiator=alice, other=bob)
    message = send(alice, conversation)

    with pytest.raises(services.MessagingRejectedError):
        services.soft_delete_message(actor=bob, message=message)

    services.soft_delete_message(actor=alice, message=message)
    message.refresh_from_db()
    assert message.deleted_at is not None
    # Soft: the row survives, so the sequence keeps no gap.
    assert Message.objects.filter(pk=message.pk).exists()


def test_deleting_does_not_renumber_the_conversation(alice: User, bob: User) -> None:
    """A gap in `seq` is fine; renumbering would corrupt every client's cursor."""
    conversation = services.start_dm(initiator=alice, other=bob)
    first = send(alice, conversation)
    second = send(alice, conversation)

    services.soft_delete_message(actor=alice, message=first)

    second.refresh_from_db()
    assert second.seq == 2
    conversation.refresh_from_db()
    assert conversation.last_message_seq == 2


# ---------------------------------------------------------------------------
# Publish-after-commit — rule 11
# ---------------------------------------------------------------------------


def test_nothing_is_published_when_the_transaction_rolls_back(
    alice: User, bob: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rule 11, stated as a test.

    A socket event delivered for a rolled-back write has announced a message
    that does not exist, and no client-side cleverness recovers from that.
    """
    from django.db import transaction as db_transaction

    from messaging import events

    published: list[dict[str, Any]] = []
    monkeypatch.setattr(events, "publish", lambda **kwargs: published.append(kwargs))

    conversation = services.start_dm(initiator=alice, other=bob)

    class RollbackError(Exception):
        pass

    with pytest.raises(RollbackError), db_transaction.atomic():
        services.send_message(
            sender=alice,
            conversation=conversation,
            client_id=str(uuid.uuid4()),
            body="doomed",
        )
        raise RollbackError

    assert published == []
    assert not Message.objects.filter(conversation=conversation).exists()


@pytest.mark.django_db(transaction=True)
def test_a_committed_message_is_published_to_every_member(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Addressed per recipient, so the gateway never asks who is a member.

    `transaction=True` so `on_commit` actually fires — under the default
    wrapper it never would, and the assertion would be vacuous.
    """
    from messaging import events

    alice = User.objects.create_user("pub-a@example.com", "pub-a", "pw-pub-12345")
    bob = User.objects.create_user("pub-b@example.com", "pub-b", "pw-pub-12345")
    carol = User.objects.create_user("pub-c@example.com", "pub-c", "pw-pub-12345")
    conversation = services.start_group(initiator=alice, others=[bob, carol])

    published: list[dict[str, Any]] = []
    monkeypatch.setattr(events, "publish", lambda **kwargs: published.append(kwargs))

    services.send_message(
        sender=alice,
        conversation=conversation,
        client_id=str(uuid.uuid4()),
        body="hello all",
    )

    assert len(published) == 1
    event = published[0]
    assert event["event_type"] == "message.created"
    assert event["seq"] == 1
    assert set(event["recipient_ids"]) == {alice.pk, bob.pk, carol.pk}


def test_channel_name_is_derived_from_the_user_id() -> None:
    """Django and the gateway must agree on this string or nothing arrives.

    `packages/realtime-events/src/index.ts` holds the other half.
    """
    from messaging.events import channel_for

    assert channel_for(1234) == "user.1234"


def test_only_known_event_types_can_be_published() -> None:
    """Django and the browser validate against the same three names.

    `packages/realtime-events` drops a frame whose type it does not know, so
    publishing a fourth type without adding it there would deliver nothing at
    all. Failing here makes that a crash in one place instead of silence in
    another.
    """
    from messaging.events import EVENT_TYPES, publish

    assert set(EVENT_TYPES) == {"message.created", "message.read", "message.deleted"}

    with pytest.raises(ValueError, match="unknown realtime event type"):
        publish(
            conversation_id=1,
            recipient_ids=[1],
            event_type="message.edited",
            seq=1,
            payload={},
        )
