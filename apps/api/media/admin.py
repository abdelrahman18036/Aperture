"""Admin for the media app."""

from __future__ import annotations

from django.contrib import admin
from unfold.admin import ModelAdmin

from media.models import Media


@admin.register(Media)
class MediaAdmin(ModelAdmin):
    list_display = ("id", "owner", "kind", "state", "width", "height", "created_at")
    list_filter = ("kind", "state")
    search_fields = ("object_key", "owner__username")
    ordering = ("-id",)
    autocomplete_fields = ("owner",)
    readonly_fields = ("id", "created_at", "updated_at", "deleted_at")
