"""Reads for the messaging app.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly.

**Membership is the access control, and blocking is enforced on top of it.**

Membership alone was the original argument here, and it was wrong.
`01-ARCHITECTURE.md` §11 names the read paths blocking must cover — "feed,
search, comments, **DMs**, notifications" — and a thread you are already a
member of is exactly the case where membership tells you nothing. Blocking
someone you have a history with is the whole point of blocking them; leaving
the history readable, and leaving them in your inbox, is the version of the
feature that does not work.

Two shapes, because a DM and a group are not the same question:

- **A DM with a blocked counterpart disappears.** Not in the inbox, 404 on
  open, 404 on call, 404 on send. There is nothing else in that conversation.
- **A group survives, minus that person.** Losing a thread of thirty people
  because one of them blocked you would be the block acting on the wrong
  target.

Both directions, always. A block that only hides the blocker from the blocked
leaves the blocked account able to watch, which is `users.selectors` rule and
applies here identically.
"""

from __future__ import annotations

from django.db.models import QuerySet

from messaging.models import Conversation, ConversationMember, Message
from users.models import User
from users.selectors import blocked_ids, exclude_blocked

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def memberships(user: User) -> QuerySet[ConversationMember]:
    """Every conversation this user can still see. Served by the `user` index.

    "Can still see" rather than "belongs to": a DM whose other member is in a
    block relationship is filtered out here, which is what makes it vanish
    from the inbox, the unread counts, and every path that starts from a
    membership. One place to audit, per rule 8.
    """
    rows = ConversationMember.objects.filter(user=user).select_related("conversation")

    hidden = blocked_ids(user)
    if not hidden:
        return rows

    # Only DMs. A group is not forfeited because one member blocked you — its
    # messages are filtered instead, in `messages_after` and `messages_before`.
    return rows.exclude(
        conversation__kind=Conversation.Kind.DM,
        conversation__members__user_id__in=hidden,
    )


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

    Every message read and write goes through this, and calls too, via
    `calls.selectors.callable_conversation`. Returning None rather than
    raising lets the view answer 404 — telling someone a conversation exists
    but is not theirs is an enumeration oracle.

    Built on `memberships`, so a blocked DM is *not their conversation* as far
    as every caller is concerned: opening it, sending to it, marking it read
    and ringing it all answer 404 without any of them knowing why.
    """
    return (
        memberships(user)
        .filter(conversation_id=conversation_id)
        .select_related("conversation")
        .first()
    )


def members_of(conversation: Conversation) -> QuerySet[ConversationMember]:
    return ConversationMember.objects.filter(conversation=conversation).select_related(
        "user", "user__avatar_media"
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
    *,
    conversation: Conversation,
    after_seq: int,
    viewer: User | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> QuerySet[Message]:
    """**The reconnect sync.** Everything newer than a known position.

    This is the entire offline story, and it is one index scan. `seq` is
    server-assigned and monotonic per conversation, so "send me everything
    after 4821" is unambiguous, gap-free and needs no clock — which is exactly
    why `01-ARCHITECTURE.md` §5 calls it one of the two most important lines
    in the schema.
    """
    live = Message.objects.filter(
        conversation=conversation,
        seq__gt=after_seq,
        deleted_at__isnull=True,
    ).select_related("sender", "sender__avatar_media", "media")

    # Rule 8. Filtered before the slice, or a page could come back short of
    # its limit while more messages waited behind the ones removed.
    live = exclude_blocked(live, viewer, author_field="sender_id")

    return live.order_by("seq")[: min(limit, MAX_PAGE_SIZE)]


def messages_before(
    *,
    conversation: Conversation,
    before_seq: int | None = None,
    viewer: User | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> QuerySet[Message]:
    """Scrollback. The same index, read the other way."""
    history = Message.objects.filter(
        conversation=conversation, deleted_at__isnull=True
    ).select_related("sender", "sender__avatar_media", "media")

    if before_seq is not None:
        history = history.filter(seq__lt=before_seq)

    history = exclude_blocked(history, viewer, author_field="sender_id")

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
