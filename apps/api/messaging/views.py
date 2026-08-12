"""Views for the messaging app.

Thin by rule: parse the request, call a selector or a service, return.

**Writes arrive over HTTP, not over the socket.** `seq` allocation and
`client_id` idempotency happen in one Postgres transaction that only Django
can run, so sending over the socket would mean Node forwarding to Django
anyway — an extra hop for nothing. It also means *send message* is a typed
call in the generated client, and optimistic UI hides the round trip
completely. `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from media.models import Media
from messaging import selectors, services, tickets
from messaging.models import ConversationMember
from messaging.serializers import (
    ConversationSerializer,
    MarkReadSerializer,
    MessagePageSerializer,
    MessageSerializer,
    RealtimeTicketSerializer,
    SendMessageResponseSerializer,
    SendMessageSerializer,
    StartConversationSerializer,
    conversation_payload,
)
from moderation.throttling import MessageThrottle
from users import presence
from users.selectors import by_username


class RealtimeTicketView(APIView):
    """`POST /api/realtime/ticket` — a 60-second credential for the gateway.

    The browser cannot set headers on a WebSocket handshake, so the ticket
    travels as a query parameter. That is only acceptable because it expires
    in a minute: a long-lived credential in a URL ends up in access logs and
    referrers.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="realtime_ticket",
        request=None,
        responses={200: RealtimeTicketSerializer},
        description=(
            "Mint a short-lived signed ticket for the socket gateway. The "
            "gateway verifies it locally and never calls back."
        ),
    )
    def post(self, request: Request) -> Response:
        from django.conf import settings

        token, ttl = tickets.mint(user_id=current_user(request).pk)
        return Response(
            {
                "ticket": token,
                "url": settings.REALTIME_URL,
                "expires_in_seconds": ttl,
            }
        )


class ConversationListView(APIView):
    """`GET /api/messaging/conversations` — the inbox."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="messaging_conversations",
        responses={200: ConversationSerializer(many=True)},
        description="Conversations you are in, most recently active first.",
    )
    def get(self, request: Request) -> Response:
        viewer = current_user(request)
        members = list(selectors.inbox(viewer))
        unread = selectors.unread_counts(user=viewer)

        # One query for every conversation's other members and their read
        # positions, rather than two per conversation. See `other_members_for`.
        conversation_ids = [member.conversation_id for member in members]
        others_by_conversation = selectors.other_members_for(
            conversation_ids=conversation_ids, viewer=viewer
        )
        # And one more for every conversation's last message, so the whole
        # inbox is a constant number of queries rather than three per row.
        last_by_conversation = selectors.last_messages_for(
            conversation_ids=conversation_ids, viewer=viewer
        )

        # One Redis round trip for the whole inbox, for the same reason the
        # member queries are batched.
        connected = presence.online_ids(
            [
                user.pk
                for entry in others_by_conversation.values()
                for user in entry.users
            ]
        )

        rows: list[dict[str, Any]] = []
        for member in members:
            other = others_by_conversation[member.conversation_id]
            last = last_by_conversation.get(member.conversation_id)
            rows.append(
                conversation_payload(
                    member=member,
                    members=other.users,
                    unread=unread.get(member.conversation_id, 0),
                    last_message=last,
                    others_read=other.read_positions,
                    online=[
                        str(user.pk) for user in other.users if user.pk in connected
                    ],
                )
            )
        return Response(rows)

    @extend_schema(
        operation_id="messaging_start",
        request=StartConversationSerializer,
        responses={201: ConversationSerializer, 400: None},
        description="Start a DM or a group. A DM between two people is unique.",
    )
    def post(self, request: Request) -> Response:
        form = StartConversationSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        viewer = current_user(request)

        others = []
        for username in form.validated_data["usernames"]:
            other = by_username(username)
            if other is None:
                raise NotFound(f"No such account: {username}")
            others.append(other)

        try:
            if len(others) == 1:
                conversation = services.start_dm(initiator=viewer, other=others[0])
            else:
                conversation = services.start_group(
                    initiator=viewer,
                    others=others,
                    title=form.validated_data["title"],
                )
        except services.MessagingRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        member = selectors.membership_or_none(
            user=viewer, conversation_id=conversation.pk
        )
        assert member is not None  # noqa: S101 - just created
        return Response(
            conversation_payload(
                member=member,
                members=others,
                unread=0,
                last_message=None,
                others_read=selectors.other_members_for(
                    conversation_ids=[conversation.pk], viewer=viewer
                )[conversation.pk].read_positions,
                online=[
                    str(user.pk)
                    for user in others
                    if user.pk in presence.online_ids([u.pk for u in others])
                ],
            ),
            status=status.HTTP_201_CREATED,
        )


def _member_or_404(request: Request, conversation_id: str) -> ConversationMember:
    """Membership is the access control, and 404 rather than 403.

    Telling someone a conversation exists but is not theirs is an enumeration
    oracle over other people's private threads.
    """
    member = selectors.membership_or_none(
        user=current_user(request), conversation_id=int(conversation_id)
    )
    if member is None:
        raise NotFound("No such conversation.")
    return member


class MessageListView(APIView):
    """`GET`/`POST /api/messaging/conversations/{id}/messages`.

    `?after=` is the reconnect sync: everything newer than a known `seq`.
    `?before=` is scrollback. Both are one index scan on
    `(conversation, seq)`.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [MessageThrottle]

    @extend_schema(
        operation_id="messaging_messages",
        parameters=[
            OpenApiParameter(
                name="after",
                required=False,
                type=int,
                description=(
                    "Return everything with a higher seq. This is the whole "
                    "offline-sync story: 'send me everything after 4821'."
                ),
            ),
            OpenApiParameter(
                name="before",
                required=False,
                type=int,
                description="Scrollback: return messages older than this seq.",
            ),
        ],
        responses={200: MessagePageSerializer, 404: None},
        description="A window of a conversation, addressed by seq.",
    )
    def get(self, request: Request, conversation_id: str) -> Response:
        member = _member_or_404(request, conversation_id)
        conversation = member.conversation

        after = request.query_params.get("after")
        if after is not None:
            messages = list(
                selectors.messages_after(
                    conversation=conversation,
                    after_seq=int(after),
                    viewer=current_user(request),
                )
            )
        else:
            before = request.query_params.get("before")
            messages = list(
                selectors.messages_before(
                    conversation=conversation,
                    before_seq=int(before) if before else None,
                    viewer=current_user(request),
                )
            )
            # Read newest-first for the index, handed back oldest-first
            # because that is the order a thread is read in.
            messages.reverse()

        return Response(
            {
                "messages": MessageSerializer(messages, many=True).data,
                "last_message_seq": conversation.last_message_seq,
                "oldest_seq": messages[0].seq if messages else None,
            }
        )

    @extend_schema(
        operation_id="messaging_send",
        request=SendMessageSerializer,
        responses={201: SendMessageResponseSerializer, 400: None, 404: None},
        description=(
            "Send a message. Idempotent on client_id: retrying after a "
            "timeout returns the message that already exists rather than "
            "creating a second one."
        ),
    )
    def post(self, request: Request, conversation_id: str) -> Response:
        member = _member_or_404(request, conversation_id)

        form = SendMessageSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        media: Media | None = None
        raw_media = form.validated_data["media_id"]
        if raw_media:
            media = Media.objects.filter(
                pk=int(raw_media),
                owner=current_user(request),
                state=Media.State.READY,
                deleted_at__isnull=True,
            ).first()
            if media is None:
                return Response(
                    {"detail": "That media is missing, not ready, or not yours."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            message, created = services.send_message(
                sender=current_user(request),
                conversation=member.conversation,
                client_id=str(form.validated_data["client_id"]),
                body=form.validated_data["body"],
                media=media,
                reply_to_seq=form.validated_data["reply_to_seq"],
            )
        except services.MessagingRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {"message": MessageSerializer(message).data, "created": created},
            status=status.HTTP_201_CREATED,
        )


class MarkReadView(APIView):
    """`POST /api/messaging/conversations/{id}/read` — a read receipt."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="messaging_mark_read",
        request=MarkReadSerializer,
        responses={204: None, 404: None},
        description="Move your read position forward. Never backward.",
    )
    def post(self, request: Request, conversation_id: str) -> Response:
        member = _member_or_404(request, conversation_id)
        form = MarkReadSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        services.mark_read(member=member, up_to_seq=form.validated_data["up_to_seq"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="messaging_delete_message",
        responses={204: None, 404: None},
        description="Soft delete your own message.",
    )
    def delete(self, request: Request, conversation_id: str, seq: int) -> Response:
        member = _member_or_404(request, conversation_id)
        message = selectors.message_by_seq(conversation=member.conversation, seq=seq)
        if message is None:
            raise NotFound("No such message.")
        try:
            services.soft_delete_message(actor=current_user(request), message=message)
        except services.MessagingRejectedError as error:
            # Someone else's message. 404 rather than 403 — a member can already
            # see it, so this leaks nothing, and it keeps one shape for "no".
            raise NotFound(str(error)) from error
        return Response(status=status.HTTP_204_NO_CONTENT)
