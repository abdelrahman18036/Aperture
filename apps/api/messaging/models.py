"""Conversations and messages.

Two lines in this module carry more weight than the rest of the schema
combined, and `01-ARCHITECTURE.md` §5 says so outright:

- **`Message.seq`** — server-assigned and monotonic per conversation. It gives
  correct ordering without trusting browser clocks, and it turns offline sync
  into "send me everything after 4821".
- **`UNIQUE (conversation, client_id)`** — makes a flaky-network retry a no-op
  instead of a duplicate message.

Both are miserable to retrofit onto live conversations, which is why they are
here in Phase 1 even though messaging is not built until Phase 6.

Only Django writes these tables. `apps/realtime` reads none of them: it learns
about a new message from Redis, never from Postgres.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.ids import snowflake


class Conversation(models.Model):
    """A DM or a group thread."""

    class Kind(models.TextChoices):
        DM = "dm", "Direct message"
        GROUP = "group", "Group"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.DM)
    title = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    #: The high-water mark. Allocated under `SELECT ... FOR UPDATE` in the
    #: same transaction as the message insert, which is what makes the
    #: sequence gapless and correctly ordered.
    last_message_seq = models.BigIntegerField(default=0)

    class Meta:
        db_table = "conversations"

    def __str__(self) -> str:
        return f"{self.kind}:{self.id}"


class ConversationMember(models.Model):
    """Someone's membership of a conversation, and their read position."""

    class Role(models.TextChoices):
        MEMBER = "member", "Member"
        ADMIN = "admin", "Admin"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    conversation = models.ForeignKey(
        "messaging.Conversation", on_delete=models.CASCADE, related_name="members"
    )
    user = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="conversation_memberships"
    )
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(default=timezone.now, editable=False)

    #: Read receipts and unread counts both derive from this, by subtraction
    #: against the conversation's `last_message_seq`. No COUNT(*) anywhere.
    last_read_seq = models.BigIntegerField(default=0)
    muted_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "conversation_members"
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "user"], name="conversation_members_unique"
            ),
        ]
        indexes = [
            # The inbox: every conversation this person is in.
            models.Index(fields=["user"], name="conv_members_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} in {self.conversation_id}"


class Message(models.Model):
    """One message.

    Writes arrive over HTTP rather than over the socket, because `seq`
    allocation and `client_id` idempotency have to happen in a single Postgres
    transaction that only Django can run. The socket is the delivery path, not
    the write path — see `01-ARCHITECTURE.md` §8.
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    conversation = models.ForeignKey(
        "messaging.Conversation", on_delete=models.CASCADE, related_name="messages"
    )

    #: Server-assigned, monotonic within the conversation, allocated under a
    #: row lock on `Conversation.last_message_seq`. Never taken from the
    #: client, and never derived from a timestamp.
    seq = models.BigIntegerField()

    sender = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="messages_sent"
    )
    body = models.TextField(max_length=4000, blank=True)
    media = models.ForeignKey(
        "media.Media",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="messages",
    )

    #: A post sent into the conversation — "reshare".
    #:
    #: A reference rather than a copy, so the message shows the post as it is
    #: now: an edited caption or a deleted post is reflected here rather than
    #: preserved as a snapshot of a moment. `SET_NULL` because a hard-deleted
    #: post must not take the conversation around it with it; the client
    #: renders "this post is no longer available".
    shared_post = models.ForeignKey(
        "posts.Post",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="shared_in_messages",
    )

    #: The story this message is a reply to.
    #:
    #: A story reply *is* a direct message — that is the whole feature — but a
    #: message with no context reaching an author who posted four frames today
    #: is a question they cannot answer. This is the context. `SET_NULL`
    #: because stories expire and the reply outlives them.
    replied_story = models.ForeignKey(
        "stories.Story",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )

    #: Idempotency key minted by the browser. The unique constraint below is
    #: the entire duplicate-message story: catch IntegrityError on insert and
    #: return the message that already exists.
    client_id = models.UUIDField()

    reply_to_seq = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    deleted_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        db_table = "messages"
        constraints = [
            models.UniqueConstraint(
                fields=["conversation", "seq"], name="messages_unique_seq"
            ),
            models.UniqueConstraint(
                fields=["conversation", "client_id"], name="messages_unique_client_id"
            ),
        ]
        indexes = [
            # Cursor sync: "everything in this conversation after seq N".
            models.Index(
                fields=["conversation", "-seq"], name="messages_conv_seq_desc_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.conversation_id}#{self.seq}"

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class MessageHidden(models.Model):
    """One person's decision to stop seeing one message.

    **"Delete for me" and "delete for everyone" are different operations and
    this is what makes them different.** Deleting for everyone sets
    `Message.deleted_at` and the message is gone for the room; deleting for
    yourself writes a row here and changes nothing anybody else sees.

    A row rather than a flag on the message, because the message is shared and
    the decision is not — and rather than actually deleting, because the
    sequence has to stay dense: `seq` is what reconnect sync walks, and a hole
    in it is a client that thinks it missed something forever.
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    message = models.ForeignKey(
        Message, on_delete=models.CASCADE, related_name="hidden_for"
    )
    user = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="hidden_messages"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "message_hidden"
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user"], name="message_hidden_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user.pk} hid {self.message.pk}"
