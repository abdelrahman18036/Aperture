"""Writes for the counters app.

Business transactions live here, and this is the only place `.save()` is
called. Increments arrive from Celery tasks, never from a request path.
"""

from __future__ import annotations

from django.core.cache import cache
from django.db.models import F

from counters.models import Counter
from counters.selectors import cache_key


def increment(*, entity_type: str, entity_id: int, metric: str, delta: int = 1) -> None:
    """Move a counter, creating it if this is the first time.

    `F("value") + delta` rather than read-modify-write: two workers liking the
    same post in the same instant must not lose one of the likes, and the
    database is the only thing in a position to guarantee that.

    The cache is **deleted, not updated**. Writing the new value would race
    with a concurrent increment and could persist a number that was never
    true; deleting means the next read pays one query and gets the truth.
    """
    updated = Counter.objects.filter(
        entity_type=entity_type, entity_id=entity_id, metric=metric
    ).update(value=F("value") + delta)

    if updated == 0:
        # First touch. `get_or_create` rather than `create` because two tasks
        # can arrive here together; the unique constraint decides, and the
        # loser falls through to the update below.
        _, created = Counter.objects.get_or_create(
            entity_type=entity_type,
            entity_id=entity_id,
            metric=metric,
            defaults={"value": max(delta, 0)},
        )
        if not created:
            Counter.objects.filter(
                entity_type=entity_type, entity_id=entity_id, metric=metric
            ).update(value=F("value") + delta)

    cache.delete(cache_key(entity_type, entity_id, metric))


def set_value(*, entity_type: str, entity_id: int, metric: str, value: int) -> None:
    """Overwrite a counter outright. For backfills and repairs only."""
    Counter.objects.update_or_create(
        entity_type=entity_type,
        entity_id=entity_id,
        metric=metric,
        defaults={"value": value},
    )
    cache.delete(cache_key(entity_type, entity_id, metric))
