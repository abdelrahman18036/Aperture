"""DRF shapes for the messaging app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.

**These are also the socket payloads.** When Django publishes a message event,
the payload is `MessageSerializer(message).data` — the same output the REST
endpoint returns — so its type is already in the OpenAPI schema and already in
`packages/api-client`. Only the five-field envelope is hand-typed, in
`packages/realtime-events`. See `01-ARCHITECTURE.md` §3.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from config.fields import SnowflakeField
from media.serializers import MediaSerializer
from messaging.models import Conversation, ConversationMember, Message
from users.serializers import UserSerializer


class MessageSerializer(serializers.ModelSerializer[Message]):
    id = SnowflakeField(read_only=True)
    conversation_id = SnowflakeField(read_only=True)
    sender = UserSerializer(read_only=True)
    media = MediaSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Message
        fields = (
            "id",
            "conversation_id",
            "seq",
            "sender",
            "body",
            "media",
            "client_id",
            "reply_to_seq",
            "created_at",
        )
        read_only_fields = fields


class ConversationSerializer(serializers.Serializer[dict[str, Any]]):
    """A conversation as it appears in the inbox."""

    id = serializers.CharField(read_only=True)
    kind = serializers.CharField(read_only=True)
    title = serializers.CharField(read_only=True, allow_blank=True)
    members = UserSerializer(many=True, read_only=True)
    last_message_seq = serializers.IntegerField(read_only=True)
    last_read_seq = serializers.IntegerField(read_only=True)
    unread_count = serializers.IntegerField(read_only=True)
    last_message = MessageSerializer(read_only=True, allow_null=True)
    #: user id (string) -> how far that member has read. Everyone but you.
    others_read = serializers.DictField(
        child=serializers.IntegerField(), read_only=True
    )
    #: Ids (as strings) of the other members connected right now. The socket
    #: keeps this current with `presence` events; this is what a thread opens
    #: with, so the header is right before anybody moves.
    online = serializers.ListField(child=serializers.CharField(), read_only=True)


class MessagePageSerializer(serializers.Serializer[dict[str, Any]]):
    """A window of a conversation, addressed by `seq` rather than by offset."""

    messages = MessageSerializer(many=True, read_only=True)
    last_message_seq = serializers.IntegerField(read_only=True)
    #: Oldest seq in this page; pass it back as `before` to scroll further.
    oldest_seq = serializers.IntegerField(read_only=True, allow_null=True)


class SendMessageSerializer(serializers.Serializer[dict[str, Any]]):
    """What the client sends.

    `client_id` is required and minted by the browser. It is the only thing
    standing between a flaky network and a duplicated message, so there is no
    server-side default — a client that does not send one does not get
    idempotency, and should be made to notice.
    """

    client_id = serializers.UUIDField()
    body = serializers.CharField(
        max_length=4000, allow_blank=True, required=False, default=""
    )
    media_id = serializers.CharField(required=False, allow_null=True, default=None)
    reply_to_seq = serializers.IntegerField(
        required=False, allow_null=True, default=None
    )


class SendMessageResponseSerializer(serializers.Serializer[dict[str, Any]]):
    message = MessageSerializer(read_only=True)
    #: False when the `client_id` had already been used — the retry was a
    #: no-op and this is the message that already existed.
    created = serializers.BooleanField(read_only=True)


class StartConversationSerializer(serializers.Serializer[dict[str, Any]]):
    usernames = serializers.ListField(
        child=serializers.CharField(), min_length=1, max_length=31
    )
    title = serializers.CharField(
        max_length=120, allow_blank=True, required=False, default=""
    )


class MarkReadSerializer(serializers.Serializer[dict[str, Any]]):
    up_to_seq = serializers.IntegerField(min_value=0)


class RealtimeTicketSerializer(serializers.Serializer[dict[str, Any]]):
    """A short-lived credential for the socket gateway."""

    ticket = serializers.CharField(read_only=True)
    url = serializers.CharField(read_only=True)
    expires_in_seconds = serializers.IntegerField(read_only=True)


def conversation_payload(
    *,
    member: ConversationMember,
    members: list[Any],
    unread: int,
    last_message: Message | None,
    others_read: dict[str, int] | None = None,
    online: list[str] | None = None,
) -> dict[str, Any]:
    """Assemble the inbox row. Formatting, not logic."""
    conversation: Conversation = member.conversation
    return {
        "id": str(conversation.pk),
        "kind": conversation.kind,
        "title": conversation.title,
        # `.data` here, unlike in `users.views`, because this payload is
        # returned raw rather than passed through `ConversationSerializer` —
        # the serializer names the response shape for drf-spectacular and
        # never runs. Handing instances out would fail JSON encoding.
        "members": UserSerializer(members, many=True).data,
        "last_message_seq": conversation.last_message_seq,
        "last_read_seq": member.last_read_seq,
        "unread_count": unread,
        "last_message": (
            MessageSerializer(last_message).data if last_message else None
        ),
        #: How far every *other* member has read, keyed by user id as a
        #: string. `last_read_seq` above is only your own, which is enough to
        #: count what you have not read and no use at all for showing whether
        #: what you sent has been seen. The socket keeps this current with
        #: `message.read`; this is the value it starts from.
        "others_read": others_read or {},
        "online": online or [],
    }
