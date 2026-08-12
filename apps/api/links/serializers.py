"""DRF shapes for the links app."""

from __future__ import annotations

from rest_framework import serializers

from links.models import LinkPreview


class LinkPreviewSerializer(serializers.ModelSerializer[LinkPreview]):
    """A link card.

    Every field is somebody else's HTML, so the client escapes all of it and
    treats `title` as a string found in a `<meta>` tag rather than as a fact.
    """

    class Meta:
        model = LinkPreview
        fields = ("url", "state", "title", "description", "image_url", "site_name")
        read_only_fields = fields
