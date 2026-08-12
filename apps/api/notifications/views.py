"""Views for the notifications app."""

from __future__ import annotations

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from notifications import selectors, services
from notifications.serializers import NotificationPageSerializer


class NotificationListView(APIView):
    """`GET /api/notifications/list` — what happened while you were away.

    Named rather than sitting at the bare collection path, for the reason
    `calls/urls.py` records: a trailing slash Next normalises away turns a
    POST into a 500 and a GET into a redirect on every fetch.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="notifications_list",
        parameters=[
            OpenApiParameter(name="cursor", required=False, type=str),
        ],
        responses={200: NotificationPageSerializer},
        description="Your notifications, newest first, cursor-paginated.",
    )
    def get(self, request: Request) -> Response:
        viewer = current_user(request)

        raw = request.query_params.get("cursor")
        try:
            before_id = int(raw) if raw else None
        except ValueError:
            before_id = None

        rows = list(selectors.page(user=viewer, before_id=before_id))
        next_cursor = (
            str(rows[-1].pk) if len(rows) == selectors.DEFAULT_PAGE_SIZE else None
        )

        return Response(
            NotificationPageSerializer(
                {
                    "notifications": rows,
                    "next_cursor": next_cursor,
                    "unread_count": selectors.unread_count(viewer),
                }
            ).data
        )


class MarkReadView(APIView):
    """`POST /api/notifications/read` — clear the badge."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="notifications_mark_read",
        request=None,
        responses={204: None},
        description="Mark every notification read.",
    )
    def post(self, request: Request) -> Response:
        services.mark_all_read(user=current_user(request))
        return Response(status=status.HTTP_204_NO_CONTENT)
