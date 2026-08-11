"""Reads for the messaging app.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly.

**Membership is the access control.** There is no "public" conversation and no
blocked-user filter on messages: you are either a member of a conversation or
you cannot see it at all, and every selector here starts from that. Blocking
is enforced when a conversation is *created* and when a message is *sent*,
which is the point at which it can still do something useful.
"""

from __future__ import annotations

from django.db.models import QuerySet

from messaging.models import Conversation, ConversationMember, Message
from users.models import User

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def memberships(user: User) -> QuerySet[ConversationMember]:
    """Every conversation this user belongs to. Served by the `user` index."""
    return ConversationMember.objects.filter(user=user).select_related("conversation")


def inbox(user: User) -> QuerySet[ConversationMember]:
    """The inbox, most recently active first.

    Ordered by the conversation's `last_message_seq`... no: by its id, which
    for an active conversation moves with nothing. Ordered by the *last
    message's* arrival instead, which is what a person means by "recent".
    """
    return memberships(user).order_by("-conversation__last_message_seq", "-id")


def membership_or_none(
    *, user: User, conversation_id: int
) -> ConversationMember | None:
    """The caller's membership, or None if they are not in this conversation.

    Every message read and write goes through this. Returning None rather than
    raising lets the view answer 404 — telling someone a conversation exists
    but is not theirs is an enumeration oracle.
    """
    return (
        ConversationMember.objects.filter(user=user, conversation_id=conversation_id)
        .select_related("conversation")
        .first()
    )


def members_of(conversation: Conversation) -> QuerySet[ConversationMember]:
    return ConversationMember.objects.filter(conversation=conversation).select_related(
        "user"
    )


def existing_dm(*, a: User, b: User) -> Conversation | None:
    """The one-to-one conversation between two people, if it exists.

    Two people get exactly one DM thread forever. Without this check,
    "message" from two different screens produces two threads and the history
    splits in half.
    """
    return (
        Conversation.objects.filter(
            kind=Conversation.Kind.DM,
            members__user=a,
        )
        .filter(members__user=b)
        .first()
    )


def messages_after(
    *, conversation: Conversation, after_seq: int, limit: int = DEFAULT_PAGE_SIZE
) -> QuerySet[Message]:
    """**The reconnect sync.** Everything newer than a known position.

    This is the entire offline story, and it is one index scan. `seq` is
    server-assigned and monotonic per conversation, so "send me everything
    after 4821" is unambiguous, gap-free and needs no clock — which is exactly
    why `01-ARCHITECTURE.md` §5 calls it one of the two most important lines
    in the schema.
    """
    return (
        Message.objects.filter(
            conversation=conversation,
            seq__gt=after_seq,
            deleted_at__isnull=True,
        )
        .select_related("sender", "media")
        .order_by("seq")[: min(limit, MAX_PAGE_SIZE)]
    )


def messages_before(
    *,
    conversation: Conversation,
    before_seq: int | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> QuerySet[Message]:
    """Scrollback. The same index, read the other way."""
    history = Message.objects.filter(
        conversation=conversation, deleted_at__isnull=True
    ).select_related("sender", "media")

    if before_seq is not None:
        history = history.filter(seq__lt=before_seq)

    return history.order_by("-seq")[: min(limit, MAX_PAGE_SIZE)]


def message_by_client_id(
    *, conversation: Conversation, client_id: str
) -> Message | None:
    """The message this client already sent, if it did.

    Read after an IntegrityError on the unique constraint. That constraint is
    the whole idempotency story — see `services.send_message`.
    """
    return Message.objects.filter(
        conversation=conversation, client_id=client_id
    ).first()


def message_by_seq(*, conversation: Conversation, seq: int) -> Message | None:
    """One live message by its position.

    Served by the `(conversation, seq)` unique index.
    """
    return Message.objects.filter(
        conversation=conversation, seq=seq, deleted_at__isnull=True
    ).first()


def unread_counts(*, user: User) -> dict[int, int]:
    """Unread per conversation, by subtraction rather than by counting.

    `last_message_seq - last_read_seq` is the number of messages behind, and
    it needs no `COUNT(*)` — rule 9 — because `seq` is dense and monotonic.
    Another thing that column pays for.
    """
    rows = memberships(user).values_list(
        "conversation_id", "conversation__last_message_seq", "last_read_seq"
    )
    return {
        conversation_id: max(0, last_message_seq - last_read_seq)
        for conversation_id, last_message_seq, last_read_seq in rows
    }
