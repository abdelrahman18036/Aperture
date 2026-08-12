"""Views for the calls app.

Thin by rule: parse the request, call a selector or a service, return. A view
that queries the ORM directly is the smell -- move it to `selectors.py`.

Two endpoints, and both do the same two things: authorize, then mint. Nothing
about a call's *media* passes through here.
"""

from __future__ import annotations

import time

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from calls import selectors, services
from calls.serializers import (
    CallSerializer,
    JoinCallSerializer,
    StartCallSerializer,
    call_payload,
)
from config.auth import current_user
from messaging.models import Conversation


def _conversation_or_404(request: Request, conversation_id: str) -> Conversation:
    """404 rather than 403 for a conversation that is not yours.

    Same reasoning as messaging: telling someone a conversation exists but is
    not theirs is an enumeration oracle over other people's private threads.
    """
    conversation = selectors.callable_conversation(
        user=current_user(request), conversation_id=int(conversation_id)
    )
    if conversation is None:
        raise NotFound("No such conversation.")
    return conversation


class StartCallView(APIView):
    """`POST /api/calls/start` — ring a conversation."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="calls_start",
        request=StartCallSerializer,
        responses={201: CallSerializer, 400: None, 404: None},
        description=(
            "Start a call in a conversation. Returns ICE servers for every "
            "call and a LiveKit room token for group calls, and rings the "
            "other participants over their socket."
        ),
    )
    def post(self, request: Request) -> Response:
        form = StartCallSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        conversation = _conversation_or_404(
            request, form.validated_data["conversation_id"]
        )

        try:
            call = services.start_call(
                caller=current_user(request),
                conversation=conversation,
                now=time.time(),
            )
        except services.CallRejectedError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            CallSerializer(call_payload(call)).data,
            status=status.HTTP_201_CREATED,
        )


class JoinCallView(APIView):
    """`POST /api/calls/join` — take the credentials for a call you were rung for."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="calls_join",
        request=JoinCallSerializer,
        responses={200: CallSerializer, 400: None, 404: None},
        description=(
            "Answer a call. Membership and blocks are re-checked here rather "
            "than trusted from the invite."
        ),
    )
    def post(self, request: Request) -> Response:
        form = JoinCallSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        conversation = _conversation_or_404(
            request, form.validated_data["conversation_id"]
        )

        try:
            call = services.join_call(
                user=current_user(request),
                conversation=conversation,
                call_id=int(form.validated_data["call_id"]),
                mode=form.validated_data["mode"],
                now=time.time(),
            )
        except services.CallRejectedError as error:
            return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(CallSerializer(call_payload(call)).data)
