"""DRF shapes for the stories app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from config.fields import SnowflakeField
from links.serializers import LinkPreviewSerializer
from media.serializers import MediaSerializer
from stories.models import DEFAULT_BACKGROUND, STORY_BACKGROUNDS, Story
from users.serializers import UserSerializer


class StorySerializer(serializers.ModelSerializer[Story]):
    """One frame."""

    id = SnowflakeField(read_only=True)
    author = UserSerializer(read_only=True)
    #: Null for a text story, which is the discriminator the viewer branches
    #: on — there is no `kind` column, because "has media" already answers it.
    media = MediaSerializer(read_only=True, allow_null=True)
    #: The CSS the client paints behind a text story. Sent resolved rather
    #: than as a name, so adding a background is a server change alone.
    background_css = serializers.SerializerMethodField()
    link_preview = LinkPreviewSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Story
        fields = (
            "id",
            "author",
            "media",
            "text",
            "background",
            "background_css",
            "caption",
            "link_preview",
            "created_at",
            "expires_at",
        )
        read_only_fields = fields

    @extend_schema_field(serializers.CharField())
    def get_background_css(self, story: Story) -> str:
        return STORY_BACKGROUNDS.get(story.background, STORY_BACKGROUNDS["slate"])


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
    #: Index of the first frame the viewer has not watched, or 0 when they
    #: have watched them all. Computed here because the server already knows
    #: which `StoryView` rows exist — the client would otherwise need a second
    #: request to answer "where should this open?".
    first_unseen = serializers.IntegerField(read_only=True)


class CreateStorySerializer(serializers.Serializer[dict[str, Any]]):
    #: A snowflake, so a string on the wire — above 2^53 a JSON number rounds.
    #: Optional: a story may be words instead.
    media_id = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, default=None
    )
    text = serializers.CharField(
        max_length=700, allow_blank=True, required=False, default=""
    )
    background = serializers.ChoiceField(
        choices=sorted(STORY_BACKGROUNDS), required=False, default=DEFAULT_BACKGROUND
    )
    caption = serializers.CharField(
        max_length=200, allow_blank=True, required=False, default=""
    )


class StoryViewerSerializer(serializers.Serializer[dict[str, Any]]):
    """One line of "who watched this", for the author."""

    viewer = UserSerializer(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
