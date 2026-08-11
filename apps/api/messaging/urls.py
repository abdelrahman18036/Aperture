"""URL routes for the messaging app."""

from django.urls import URLPattern, URLResolver, path

from messaging.views import (
    ConversationListView,
    MarkReadView,
    MessageDetailView,
    MessageListView,
)

app_name = "messaging"

# `<snowflake:>`, never `<int:>` — see config/converters.py. `seq` is a plain
# int on purpose: it is small, dense and per-conversation, so it never
# approaches the precision limit that ids do.
urlpatterns: list[URLPattern | URLResolver] = [
    path("conversations", ConversationListView.as_view(), name="conversations"),
    path(
        "conversations/<snowflake:conversation_id>/messages",
        MessageListView.as_view(),
        name="messages",
    ),
    path(
        "conversations/<snowflake:conversation_id>/read",
        MarkReadView.as_view(),
        name="read",
    ),
    path(
        "conversations/<snowflake:conversation_id>/messages/<int:seq>",
        MessageDetailView.as_view(),
        name="message",
    ),
]
