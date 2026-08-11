"""URL routes for the media app."""

from django.urls import URLPattern, URLResolver, path

from media.views import MediaDetailView, UploadCompleteView, UploadIntentView

app_name = "media"

urlpatterns: list[URLPattern | URLResolver] = [
    path("intent", UploadIntentView.as_view(), name="intent"),
    path("<int:media_id>", MediaDetailView.as_view(), name="detail"),
    path("<int:media_id>/complete", UploadCompleteView.as_view(), name="complete"),
]
