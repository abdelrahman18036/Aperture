"""Admin for the counters app.

Fully read-only. These rows are derived state maintained by Celery; hand
editing one produces a number that disagrees with the data it summarises and
silently stays wrong until something recomputes it.
"""

from __future__ import annotations

from django.contrib import admin
from django.http import HttpRequest
from unfold.admin import ModelAdmin

from counters.models import Counter


@admin.register(Counter)
class CounterAdmin(ModelAdmin):
    list_display = ("entity_type", "entity_id", "metric", "value", "updated_at")
    list_filter = ("entity_type", "metric")
    search_fields = ("entity_id",)
    ordering = ("-updated_at",)
    readonly_fields = (
        "id",
        "entity_type",
        "entity_id",
        "metric",
        "value",
        "updated_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self, request: HttpRequest, obj: Counter | None = None
    ) -> bool:
        return False
