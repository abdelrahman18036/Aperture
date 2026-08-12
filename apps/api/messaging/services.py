"""Writes for the messaging app.

Business transactions live here, and this is the only place `.save()` is
called.

`send_message` is the most load-bearing function in the project. Two things
have to be true of it and they are both structural rather than defensive:

1. **`seq` is allocated inside the same transaction as the insert, under a row
   lock.** Correct order, no gaps, no trust in a browser's clock.
2. **`client_id` idempotency comes from the unique constraint**, not from a
   read-then-write. A flaky-network retry is a no-op instead of a duplicate.

Both are miserable to retrofit onto live conversations, which is why the
schema carried them from Phase 1.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from media.models import Media
from messaging import events, selectors
from messaging.models import Conversation, ConversationMember, Message
from users.models import Block, User

MAX_GROUP_MEMBERS = 32


class MessagingRejectedError(Exception):
    """The action cannot be taken. The message is safe to show a user."""


def _blocked_between(a: User, b: User) -> bool:
    from django.db.models import Q

    return Block.objects.filter(
        Q(blocker=a, blocked=b) | Q(blocker=b, blocked=a)
    ).exists()


@transaction.atomic
def start_dm(*, initiator: User, other: User) -> Conversation:
    """Open (or reopen) the one conversation these two people have.

    Two people get exactly one thread forever. Creating a second would split
    the history in half, and there is no way to merge them afterwards.
    """
    if initiator.pk == other.pk:
        raise MessagingRejectedError("You cannot message yourself.")
    if _blocked_between(initiator, other):
        # Deliberately vague: confirming a block reveals it.
        raise MessagingRejectedError("That account is unavailable.")

    existing = selectors.existing_dm(a=initiator, b=other)
    if existing is not None:
        return existing

    conversation = Conversation.objects.create(kind=Conversation.Kind.DM)
    ConversationMember.objects.bulk_create(
        [
            ConversationMember(conversation=conversation, user=initiator),
            ConversationMember(conversation=conversation, user=other),
        ]
    )
    return conversation


@transaction.atomic
def start_group(
    *, initiator: User, others: list[User], title: str = ""
) -> Conversation:
    if not others:
        raise MessagingRejectedError("A group needs someone else in it.")
    if len(others) + 1 > MAX_GROUP_MEMBERS:
        raise MessagingRejectedError(
            f"A group may hold at most {MAX_GROUP_MEMBERS} people."
        )
    for other in others:
        if _blocked_between(initiator, other):
            raise MessagingRejectedError("One of those accounts is unavailable.")

    conversation = Conversation.objects.create(
        kind=Conversation.Kind.GROUP, title=title[:120]
    )
    ConversationMember.objects.bulk_create(
        [
            ConversationMember(
                conversation=conversation,
                user=initiator,
                role=ConversationMember.Role.ADMIN,
            ),
            *(
                ConversationMember(conversation=conversation, user=other)
                for other in others
            ),
        ]
    )
    return conversation


@transaction.atomic
def send_message(
    *,
    sender: User,
    conversation: Conversation,
    client_id: str,
    body: str = "",
    media: Media | None = None,
    reply_to_seq: int | None = None,
) -> tuple[Message, bool]:
    """Write a message. Returns it and whether this call created it.

    The sequence allocation is `01-ARCHITECTURE.md` §5 verbatim::

        conv = Conversation.objects.select_for_update().get(pk=...)
        conv.last_message_seq += 1
        conv.save(update_fields=["last_message_seq"])
        Message.objects.create(conversation=conv, seq=conv.last_message_seq, ...)

    `select_for_update` is what makes it correct: two people sending at the
    same instant serialise on that row, so both get a `seq` and neither gets
    the same one. Reading the maximum and adding one would let both read 4821
    and both write 4822, which the unique constraint would then reject — and
    one of them would lose a message they thought they had sent.

    Idempotency is the `UNIQUE (conversation, client_id)` constraint. The
    client mints the id, so a retry after a timeout carries the same one and
    lands here as an `IntegrityError` we can answer by returning the message
    that already exists. **That is the whole duplicate-message story.**
    """
    if not body.strip() and media is None:
        raise MessagingRejectedError("A message needs something in it.")

    # Membership is the access control; the caller has already checked it, but
    # this is a write and it is cheap to be certain.
    if not ConversationMember.objects.filter(
        conversation=conversation, user=sender
    ).exists():
        raise MessagingRejectedError("You are not in that conversation.")

    if conversation.kind == Conversation.Kind.DM:
        other = (
            ConversationMember.objects.filter(conversation=conversation)
            .exclude(user=sender)
            .select_related("user")
            .first()
        )
        if other is not None and _blocked_between(sender, other.user):
            raise MessagingRejectedError("That account is unavailable.")

    locked = Conversation.objects.select_for_update().get(pk=conversation.pk)
    next_seq = locked.last_message_seq + 1

    try:
        # The savepoint is load-bearing, not decoration. A constraint violation
        # leaves the *whole* transaction aborted in Postgres, so without an
        # inner atomic block the read-back below would raise
        # TransactionManagementError instead of returning the existing message
        # — and the retry path would fail exactly when it is needed.
        with transaction.atomic():
            message = Message.objects.create(
                conversation=locked,
                seq=next_seq,
                sender=sender,
                body=body,
                media=media,
                client_id=client_id,
                reply_to_seq=reply_to_seq,
            )
    except IntegrityError:
        # Either the same client_id twice, or — impossible under the row lock,
        # but checked anyway — a duplicate seq. Read back and return it.
        existing = selectors.message_by_client_id(
            conversation=conversation, client_id=client_id
        )
        if existing is None:
            raise
        return existing, False

    locked.last_message_seq = next_seq
    locked.save(update_fields=["last_message_seq"])

    # The sender has read their own message by definition.
    ConversationMember.objects.filter(
        conversation=locked, user=sender, last_read_seq__lt=next_seq
    ).update(last_read_seq=next_seq)

    _publish_after_commit(message, _recipient_ids(locked))
    return message, True


def _recipient_ids(conversation: Conversation) -> list[int]:
    """Who to address. Read inside the transaction, used after it commits."""
    return list(
        ConversationMember.objects.filter(conversation=conversation).values_list(
            "user_id", flat=True
        )
    )


def _publish_after_commit(message: Message, recipients: list[int]) -> None:
    """Announce the message once the transaction has actually committed.

    Serialised lazily inside the callback rather than eagerly here, so that a
    rollback costs nothing at all.
    """

    def announce() -> None:
        from messaging.serializers import MessageSerializer

        events.publish(
            conversation_id=message.conversation_id,
            recipient_ids=recipients,
            event_type="message.created",
            seq=message.seq,
            payload=MessageSerializer(message).data,
        )

    transaction.on_commit(announce)


@transaction.atomic
def mark_read(*, member: ConversationMember, up_to_seq: int) -> ConversationMember:
    """Move a read position forward. Never backward.

    Monotonic on purpose: an out-of-order acknowledgement from a client that
    reconnected mid-scroll must not un-read messages the person has seen.
    """
    if up_to_seq <= member.last_read_seq:
        return member

    capped = min(up_to_seq, member.conversation.last_message_seq)
    member.last_read_seq = capped
    member.save(update_fields=["last_read_seq"])

    seq = capped
    conversation_id = member.conversation_id
    reader_id = str(member.user_id)
    recipients = _recipient_ids(member.conversation)

    def announce() -> None:
        events.publish(
            conversation_id=conversation_id,
            recipient_ids=recipients,
            event_type="message.read",
            seq=seq,
            payload={"user_id": reader_id, "last_read_seq": seq},
        )

    transaction.on_commit(announce)
    return member


@transaction.atomic
def soft_delete_message(*, actor: User, message: Message) -> Message:
    """Withdraw a message. Yours only, and softly.

    The sender check lives here rather than only in the view's queryset: a
    service that will delete anybody's message is one careless call site away
    from being a real problem, and this is the layer that owns the write.
    """
    if message.sender_id != actor.pk:
        raise MessagingRejectedError("You can only delete your own messages.")
    return remove_message(message=message)


@transaction.atomic
def remove_message(*, message: Message) -> Message:
    """Soft-delete a message with no sender check.

    The moderation queue's entry point, and the reason the check above lives
    in `soft_delete_message` rather than in here: resolving a report *is* one
    person deleting another's message, and it is the one case where that is
    the correct outcome. Keeping the two apart means the unchecked path has to
    be reached deliberately rather than by passing the wrong `actor`.
    """
    if message.deleted_at is not None:
        return message

    message.deleted_at = timezone.now()
    message.save(update_fields=["deleted_at"])

    conversation_id = message.conversation_id
    seq = message.seq
    recipients = _recipient_ids(message.conversation)

    def announce() -> None:
        events.publish(
            conversation_id=conversation_id,
            recipient_ids=recipients,
            event_type="message.deleted",
            seq=seq,
            payload={"seq": seq},
        )

    transaction.on_commit(announce)
    return message
