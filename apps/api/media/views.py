"""Views for the media app.

Thin by rule: parse the request, call a selector or a service, return. A view
that queries the ORM directly is the smell -- move it to `selectors.py`.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from core.media import UploadRejectedError
from media import selectors, services
from media.models import Media
from media.serializers import (
    AltTextSerializer,
    MediaSerializer,
    UploadIntentRequestSerializer,
    UploadIntentResponseSerializer,
)
from moderation.throttling import UploadThrottle


def _owned_or_404(request: Request, media_id: str) -> Media:
    """404 rather than 403 for someone else's media.

    Telling an attacker that an id exists but is not theirs is an enumeration
    oracle for free.
    """
    media = selectors.for_owner_or_none(owner=current_user(request), media_id=media_id)
    if media is None:
        raise NotFound("No such media.")
    return media


class UploadIntentView(APIView):
    """`POST /api/media/intent` — reserve a row, get a URL to PUT to.

    Nothing is uploaded through this process. The response carries a presigned
    URL constrained to one content type and one exact length, good for five
    minutes.
    """

    permission_classes = [IsAuthenticated]
    # §11: hard upload rate limits, from day one. A presigned URL is cheap for
    # us to mint and expensive to have minted for free at scale.
    throttle_classes = [UploadThrottle]

    @extend_schema(
        operation_id="media_intent",
        request=UploadIntentRequestSerializer,
        responses={201: UploadIntentResponseSerializer, 400: None},
        description=(
            "Reserve a media row and return a presigned URL to PUT the file "
            "to. The row is created in state=pending; the bytes go straight "
            "to object storage and never through this server."
        ),
    )
    def post(self, request: Request) -> Response:
        form = UploadIntentRequestSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        try:
            intent = services.create_intent(
                owner=current_user(request),
                kind=form.validated_data["kind"],
                mime=form.validated_data["mime"],
                size_bytes=form.validated_data["size_bytes"],
            )
        except UploadRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        payload = {
            "media": MediaSerializer(intent.media).data,
            "upload_url": intent.upload_url,
            "expires_in_seconds": intent.expires_in_seconds,
        }
        return Response(payload, status=status.HTTP_201_CREATED)


class UploadCompleteView(APIView):
    """`POST /api/media/{id}/complete` — the PUT finished, start processing.

    Idempotent. Nothing here believes the client that the object exists; the
    worker checks, and says so if it does not.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="media_complete",
        request=None,
        responses={202: MediaSerializer, 404: None},
        description=(
            "Signal that the browser finished its PUT. Enqueues validation "
            "and derivative generation. Poll the detail endpoint until state "
            "leaves 'pending'."
        ),
    )
    def post(self, request: Request, media_id: str) -> Response:
        media = _owned_or_404(request, media_id)
        media = services.mark_uploaded(media=media)
        return Response(MediaSerializer(media).data, status=status.HTTP_202_ACCEPTED)


class MediaDetailView(APIView):
    """`GET /api/media/{id}` — what the composer polls until it is ready.

    Polling is fine in this phase; Phase 6 replaces it with a socket event.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="media_retrieve",
        responses={200: MediaSerializer, 404: None},
        description="One media row, including its processing state.",
    )
    def get(self, request: Request, media_id: str) -> Response:
        return Response(MediaSerializer(_owned_or_404(request, media_id)).data)

    @extend_schema(
        operation_id="media_set_alt_text",
        request=AltTextSerializer,
        responses={200: MediaSerializer, 404: None},
        description=(
            "Set alt text. May be empty — the field is always present, but "
            "never required."
        ),
    )
    def patch(self, request: Request, media_id: str) -> Response:
        media = _owned_or_404(request, media_id)
        form = AltTextSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        media = services.set_alt_text(
            media=media, alt_text=form.validated_data["alt_text"]
        )
        return Response(MediaSerializer(media).data)

    @extend_schema(
        operation_id="media_destroy",
        responses={204: None, 404: None},
        description="Soft delete. A scheduled job removes the objects later.",
    )
    def delete(self, request: Request, media_id: str) -> Response:
        services.soft_delete(media=_owned_or_404(request, media_id))
        return Response(status=status.HTTP_204_NO_CONTENT)
