"""DRF shapes for the stories app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from config.fields import SnowflakeField
from media.serializers import MediaSerializer
from stories.models import Story
from users.serializers import UserSerializer


class StorySerializer(serializers.ModelSerializer[Story]):
    """One frame."""

    id = SnowflakeField(read_only=True)
    author = UserSerializer(read_only=True)
    media = MediaSerializer(read_only=True)

    class Meta:
        model = Story
        fields = ("id", "author", "media", "caption", "created_at", "expires_at")
        read_only_fields = fields


class StoryTrayEntrySerializer(serializers.Serializer[dict[str, Any]]):
    """One author's worth of the tray.

    Grouped by author rather than a flat list, because that is what the tray
    renders and what the viewer advances through — flattening it here would
    only mean regrouping it in the browser.
    """

    author = UserSerializer(read_only=True)
    stories = StorySerializer(many=True, read_only=True)
    #: Whether the viewer has watched every one. Drives the ring: a full
    #: safelight ring for unwatched, a faint one once they are through.
    all_seen = serializers.BooleanField(read_only=True)
    #: Newest first across authors, so the tray can order by it.
    latest_at = serializers.DateTimeField(read_only=True)


class CreateStorySerializer(serializers.Serializer[dict[str, Any]]):
    #: A snowflake, so a string on the wire — above 2^53 a JSON number rounds.
    media_id = serializers.CharField()
    caption = serializers.CharField(
        max_length=200, allow_blank=True, required=False, default=""
    )


class StoryViewerSerializer(serializers.Serializer[dict[str, Any]]):
    """One line of "who watched this", for the author."""

    viewer = UserSerializer(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
