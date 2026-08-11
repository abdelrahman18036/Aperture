"""URL routes for the moderation app."""

from django.urls import URLPattern, URLResolver, path

from moderation.views import ReportView

app_name = "moderation"

urlpatterns: list[URLPattern | URLResolver] = [
    path("reports", ReportView.as_view(), name="reports"),
]
