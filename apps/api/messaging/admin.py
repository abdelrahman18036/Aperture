"""Admin for the messaging app.

Read-only on `seq` and `client_id` deliberately: both are server-owned, and an
admin editing either would break ordering or reintroduce a duplicate that the
unique constraint exists to prevent.
"""

from __future__ import annotations

from django.contrib import admin
from unfold.admin import ModelAdmin

from messaging.models import Conversation, ConversationMember, Message


@admin.register(Conversation)
class ConversationAdmin(ModelAdmin):
    list_display = ("id", "kind", "title", "last_message_seq", "created_at")
    list_filter = ("kind",)
    search_fields = ("title",)
    ordering = ("-id",)
    readonly_fields = ("id", "created_at", "last_message_seq")


@admin.register(ConversationMember)
class ConversationMemberAdmin(ModelAdmin):
    list_display = ("conversation", "user", "role", "last_read_seq", "joined_at")
    list_filter = ("role",)
    search_fields = ("user__username",)
    ordering = ("-id",)
    autocomplete_fields = ("conversation", "user")


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = ("conversation", "seq", "sender", "created_at", "deleted_at")
    search_fields = ("body", "sender__username")
    ordering = ("-id",)
    autocomplete_fields = ("conversation", "sender", "media")
    readonly_fields = ("id", "seq", "client_id", "created_at", "deleted_at")
