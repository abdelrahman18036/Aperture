"""Root URL configuration.

Everything the browser reaches lives under `/api/`, because Next.js rewrites
`/api/*` here and that rewrite is the only integration point between the two.
`/admin/` is reached directly — it is a staff tool, not part of the product.
"""

from __future__ import annotations

from django.contrib import admin
from django.urls import (
    URLPattern,
    URLResolver,
    include,
    path,
    register_converter,
)
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from config.converters import SnowflakeConverter
from config.health import HealthView
from messaging.views import RealtimeTicketView

# Registered here so every app's urls.py can use `<snowflake:...>`.
register_converter(SnowflakeConverter, "snowflake")

urlpatterns: list[URLPattern | URLResolver] = [
    path("admin/", admin.site.urls),
    path("api/health", HealthView.as_view(), name="health"),
    # The type boundary starts here: this schema generates
    # packages/api-client. See 01-ARCHITECTURE.md §3.
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/schema/swagger-ui",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path("api/users/", include("users.urls")),
    path("api/media/", include("media.urls")),
    path("api/posts/", include("posts.urls")),
    path("api/stories/", include("stories.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/counters/", include("counters.urls")),
    path("api/messaging/", include("messaging.urls")),
    # The socket ticket. Lives outside /api/messaging/ because the gateway
    # it authenticates carries calls signalling too, from Phase 7.
    path("api/realtime/ticket", RealtimeTicketView.as_view(), name="ticket"),
    path("api/calls/", include("calls.urls")),
    path("api/moderation/", include("moderation.urls")),
    # The moderation *console* is the Django admin, not an endpoint here.
    # That is the whole reason §11 chose this stack.
]
