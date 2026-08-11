"""Admin for the posts app."""

from __future__ import annotations

from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline

from posts.models import Comment, Like, Post, PostMedia, TimelineEntry


class PostMediaInline(TabularInline):
    model = PostMedia
    extra = 0
    autocomplete_fields = ("media",)


@admin.register(Post)
class PostAdmin(ModelAdmin):
    list_display = ("id", "author", "visibility", "created_at", "deleted_at")
    list_filter = ("visibility",)
    search_fields = ("caption", "location", "author__username")
    ordering = ("-id",)
    autocomplete_fields = ("author",)
    readonly_fields = ("id", "created_at", "deleted_at")
    inlines = [PostMediaInline]


@admin.register(PostMedia)
class PostMediaAdmin(ModelAdmin):
    list_display = ("post", "media", "position")
    ordering = ("post", "position")
    autocomplete_fields = ("post", "media")


@admin.register(Like)
class LikeAdmin(ModelAdmin):
    list_display = ("post", "user", "created_at")
    ordering = ("-id",)
    autocomplete_fields = ("post", "user")


@admin.register(Comment)
class CommentAdmin(ModelAdmin):
    list_display = ("id", "post", "author", "created_at", "deleted_at")
    search_fields = ("body", "author__username")
    ordering = ("-id",)
    autocomplete_fields = ("post", "author", "parent")
    readonly_fields = ("id", "created_at", "deleted_at")


@admin.register(TimelineEntry)
class TimelineEntryAdmin(ModelAdmin):
    """Phase 8 only — nothing writes here yet."""

    list_display = ("user", "post", "author", "score", "created_at")
    ordering = ("-id",)
    autocomplete_fields = ("user", "post", "author")
