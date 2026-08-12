"""URL routes for the users app."""

from django.urls import URLPattern, URLResolver, path

from users.views import (
    BlockView,
    ConnectionsView,
    CurrentUserView,
    FollowRequestsView,
    FollowView,
    PasswordResetConfirmView,
    PasswordResetView,
    ProfileView,
    RegisterView,
    RespondToAllRequestsView,
    RespondToRequestView,
    SearchView,
    SessionView,
)

app_name = "users"

# Order matters: the literal routes come before `<str:username>`, or signing
# in would be looked up as an account called "session".
urlpatterns: list[URLPattern | URLResolver] = [
    path("register", RegisterView.as_view(), name="register"),
    path("session", SessionView.as_view(), name="session"),
    path("me", CurrentUserView.as_view(), name="me"),
    path("search", SearchView.as_view(), name="search"),
    path("connections", ConnectionsView.as_view(), name="connections"),
    path("password/reset", PasswordResetView.as_view(), name="password-reset"),
    path(
        "password/reset/confirm",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
    path("requests", FollowRequestsView.as_view(), name="requests"),
    path(
        "requests/respond-all",
        RespondToAllRequestsView.as_view(),
        name="respond-all",
    ),
    path("<str:username>", ProfileView.as_view(), name="profile"),
    path("<str:username>/follow", FollowView.as_view(), name="follow"),
    path("<str:username>/respond", RespondToRequestView.as_view(), name="respond"),
    path("<str:username>/block", BlockView.as_view(), name="block"),
]
