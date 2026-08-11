"""URL routes for the users app."""

from django.urls import URLPattern, URLResolver, path

from users.views import CurrentUserView, SessionView

app_name = "users"

urlpatterns: list[URLPattern | URLResolver] = [
    path("session", SessionView.as_view(), name="session"),
    path("me", CurrentUserView.as_view(), name="me"),
]
