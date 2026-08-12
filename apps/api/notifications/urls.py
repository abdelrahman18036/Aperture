"""URL routes for the notifications app."""

from django.urls import URLPattern, URLResolver, path

from notifications.views import MarkReadView, NotificationListView

app_name = "notifications"

# Named routes only. See calls/urls.py — a bare collection path picks up a
# trailing slash that Next strips on the way in.
urlpatterns: list[URLPattern | URLResolver] = [
    path("list", NotificationListView.as_view(), name="list"),
    path("read", MarkReadView.as_view(), name="read"),
]
