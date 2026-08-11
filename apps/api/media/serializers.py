"""DRF shapes for the media app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.

These feed drf-spectacular, which generates `packages/api-client`. A change
here is a change to the frontend's types -- regenerate in the same commit.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from config.fields import SnowflakeField
from core.media import (
    DERIVATIVE_WIDTHS,
    derivative_key,
    object_key,
    poster_key,
    transcode_key,
)
from media import storage
from media.models import Media


class MediaSourceSerializer(serializers.Serializer[dict[str, Any]]):
    """One rendition of an image, for a `srcset`."""

    width = serializers.IntegerField()
    url = serializers.URLField()


def _sources(media: Media) -> list[dict[str, Any]]:
    """Derivative URLs, reconstructed from the id.

    Formatting, not logic — which is why it is a module function rather than
    a branch inside a serializer. Object keys are deterministic (see
    `core.media`), so the `media` table needs no `derivatives` column and this
    costs no query.

    Empty until the worker has actually produced them.
    """
    if media.state != Media.State.READY or media.kind != Media.Kind.IMAGE:
        return []
    return [
        {
            "width": width,
            "url": storage.public_url(
                bucket=media.bucket, key=derivative_key(media.pk, width)
            ),
        }
        for width in DERIVATIVE_WIDTHS
    ]


class MediaSerializer(serializers.ModelSerializer[Media]):
    """A media row as the client sees it.

    Everything the develop-in needs is here: `blurhash` for the canvas,
    `width`/`height` to reserve the space so nothing shifts, and
    `dominant_color` for the ambient glow.
    """

    id = SnowflakeField(read_only=True)
    owner_id = SnowflakeField(read_only=True)
    sources = serializers.SerializerMethodField()
    original_url = serializers.SerializerMethodField()
    poster_url = serializers.SerializerMethodField()
    video_url = serializers.SerializerMethodField()

    class Meta:
        model = Media
        fields = (
            "id",
            "owner_id",
            "kind",
            "state",
            "width",
            "height",
            "duration_ms",
            "blurhash",
            "dominant_color",
            "alt_text",
            "failure_reason",
            "created_at",
            "sources",
            "original_url",
            "poster_url",
            "video_url",
        )
        read_only_fields = fields

    @staticmethod
    def _url_or_none(media: Media, key: str) -> str | None:
        if media.state != Media.State.READY:
            return None
        return storage.public_url(bucket=media.bucket, key=key)

    # Every method field is annotated for drf-spectacular. An unannotated
    # SerializerMethodField generates a warning and an untyped hole in
    # packages/api-client, and CI runs the generator with --fail-on-warn.
    @extend_schema_field(MediaSourceSerializer(many=True))
    def get_sources(self, media: Media) -> list[dict[str, Any]]:
        return _sources(media)

    # `allow_null` rather than a bare URI type: these are null until the
    # worker has produced them, and a client typed `string` would not check.
    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_original_url(self, media: Media) -> str | None:
        return self._url_or_none(media, object_key(media.pk, media.declared_mime))

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_poster_url(self, media: Media) -> str | None:
        if media.kind != Media.Kind.VIDEO:
            return None
        return self._url_or_none(media, poster_key(media.pk))

    @extend_schema_field(serializers.URLField(allow_null=True))
    def get_video_url(self, media: Media) -> str | None:
        if media.kind != Media.Kind.VIDEO:
            return None
        return self._url_or_none(media, transcode_key(media.pk))


class UploadIntentRequestSerializer(serializers.Serializer[dict[str, Any]]):
    """What the client asks for before it uploads anything."""

    kind = serializers.ChoiceField(choices=Media.Kind.choices)
    mime = serializers.CharField(max_length=127)
    size_bytes = serializers.IntegerField(min_value=0)


class UploadIntentResponseSerializer(serializers.Serializer[dict[str, Any]]):
    """The reservation, and the URL to PUT to."""

    media = MediaSerializer(read_only=True)
    upload_url = serializers.URLField(read_only=True)
    expires_in_seconds = serializers.IntegerField(read_only=True)


class AltTextSerializer(serializers.Serializer[dict[str, Any]]):
    """Alt text may be empty, but the field is always present."""

    alt_text = serializers.CharField(max_length=1000, allow_blank=True)
