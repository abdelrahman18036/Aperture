"""DRF shapes for the notifications app."""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from config.fields import SnowflakeField
from notifications.models import Notification
from users.serializers import UserSerializer


class NotificationSerializer(serializers.ModelSerializer[Notification]):
    """One line of the list.

    Carries where to go rather than the whole subject: a notification list
    that embedded every post would be a feed with worse ergonomics, and the
    thing somebody wants from a row is to arrive at what it is about.
    """

    id = SnowflakeField(read_only=True)
    actor = UserSerializer(read_only=True)
    href = serializers.SerializerMethodField()
    #: A thumbnail of the post, when there is one, so a row is recognisable
    #: without reading it.
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            "id",
            "actor",
            "verb",
            "detail",
            "href",
            "thumbnail_url",
            "read_at",
            "created_at",
        )
        read_only_fields = fields

    @extend_schema_field(serializers.CharField())
    def get_href(self, row: Notification) -> str:
        if row.post_id is not None:
            return f"/p/{row.post_id}"
        # A follow, a request, or a story that has since expired: the actor's
        # profile is the only useful destination.
        return f"/u/{row.actor.username}"

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_thumbnail_url(self, row: Notification) -> str | None:
        from core.media import DERIVATIVE_WIDTHS, derivative_key
        from media.models import Media
        from media.storage import public_url

        post = row.post
        if post is None:
            return None
        link = post.attachments.order_by("position").select_related("media").first()
        media = link.media if link else None
        if media is None or media.state != Media.State.READY:
            return None
        return public_url(
            bucket=media.bucket, key=derivative_key(media.pk, DERIVATIVE_WIDTHS[0])
        )


class NotificationPageSerializer(serializers.Serializer[dict[str, Any]]):
    notifications = NotificationSerializer(many=True, read_only=True)
    next_cursor = serializers.CharField(read_only=True, allow_null=True)
    unread_count = serializers.IntegerField(read_only=True)
