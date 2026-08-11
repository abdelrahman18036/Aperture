"""URL routes for the media app."""

from django.urls import URLPattern, URLResolver, path

from media.views import MediaDetailView, UploadCompleteView, UploadIntentView

app_name = "media"

urlpatterns: list[URLPattern | URLResolver] = [
    path("intent", UploadIntentView.as_view(), name="intent"),
    # `<snowflake:>`, never `<int:>`. See config/converters.py — an integer
    # path parameter becomes a JavaScript number and silently rounds.
    path("<snowflake:media_id>", MediaDetailView.as_view(), name="detail"),
    path(
        "<snowflake:media_id>/complete",
        UploadCompleteView.as_view(),
        name="complete",
    ),
]
