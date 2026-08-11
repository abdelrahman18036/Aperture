"""Root URL configuration.

Everything the browser reaches lives under `/api/`, because Next.js rewrites
`/api/*` here and that rewrite is the only integration point between the two.
`/admin/` is reached directly — it is a staff tool, not part of the product.
"""

from __future__ import annotations

from django.contrib import admin
from django.urls import URLPattern, URLResolver, include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from config.health import HealthView

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
    path("api/counters/", include("counters.urls")),
    path("api/messaging/", include("messaging.urls")),
    path("api/calls/", include("calls.urls")),
    path("api/moderation/", include("moderation.urls")),
]
