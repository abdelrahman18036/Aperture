"""URL routes for the stories app."""

from django.urls import URLPattern, URLResolver, path

from stories.views import (
    AuthorStoriesView,
    CreateStoryView,
    StoryDetailView,
    StoryViewersView,
    TrayView,
)

app_name = "stories"

# Literal routes before `<snowflake:>`, and `<snowflake:>` never `<int:>` —
# see config/converters.py. An integer path parameter becomes a JavaScript
# number and silently rounds.
urlpatterns: list[URLPattern | URLResolver] = [
    # Named, like every other route here. A bare "" under a prefix
    # without a trailing slash concatenates into `api/storiescreate`;
    # with one, the tray becomes `/api/stories/` and every fetch pays an
    # APPEND_SLASH redirect because Next strips the slash on the way in.
    path("tray", TrayView.as_view(), name="tray"),
    path("create", CreateStoryView.as_view(), name="create"),
    path("by/<str:username>", AuthorStoriesView.as_view(), name="by-author"),
    path("<snowflake:story_id>", StoryDetailView.as_view(), name="detail"),
    path(
        "<snowflake:story_id>/viewers",
        StoryViewersView.as_view(),
        name="viewers",
    ),
]
