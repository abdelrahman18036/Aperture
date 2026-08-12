"""Writes for the counters app.

Business transactions live here, and this is the only place `.save()` is
called. Durable increments arrive from Celery tasks, never from a request
path — but `apply_now` below moves the *cached* number in the request that
caused it, and that distinction is the whole design of this module.
"""

from __future__ import annotations

import logging

from django.core.cache import cache
from django.db.models import F

from counters.models import Counter
from counters.selectors import CACHE_TTL_SECONDS, cache_key

logger = logging.getLogger(__name__)


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


def apply_now(*, entity_type: str, entity_id: int, metric: str, delta: int) -> None:
    """Move the cached count immediately, in the request that caused it.

    **Why this exists.** The durable write goes to Celery, and the read path
    is Redis-first — so with no worker running, or simply with one that is a
    few seconds behind, a like that was definitely recorded came back with the
    old number. Every client then had to do its own arithmetic and deliberately
    *not* trust the server's count, which is a rule that gets forgotten: the
    repost button did trust it, and snapped back to the old number a moment
    after being pressed.

    So the count in a response is now correct at the moment it is sent, and a
    client may adopt it. The queue keeps owning durability; it no longer owns
    visibility.

    `INCRBY` rather than writing an absolute value. That is exactly the race
    `increment` avoids by deleting the key instead — two concurrent likes
    computing "43 + 1" and both writing 44 — and a relative operation does not
    have it. Redis applies the deltas in whatever order they arrive and the
    total is right either way.

    The key may be absent, and then `INCRBY` would create it at the delta —
    "1 like" on a post with forty-three. So a miss seeds from the counters
    table with `add`, which is `SET NX` and therefore atomic: a second request
    that seeds at the same moment loses the race and increments the winner's
    value, which is the correct outcome rather than a lost update.

    **Failures are swallowed.** This is a cache. If Redis is unavailable the
    number is stale until the worker and the TTL sort it out, which is exactly
    where this started — a degraded count is not worth failing a like over.
    """
    key = cache_key(entity_type, entity_id, metric)
    try:
        cache.incr(key, delta)
        return
    except ValueError:
        # No key. Fall through and seed it.
        pass
    except Exception:
        logger.warning("could not move cached counter %s", key, exc_info=True)
        return

    try:
        base = (
            Counter.objects.filter(
                entity_type=entity_type, entity_id=entity_id, metric=metric
            )
            .values_list("value", flat=True)
            .first()
            or 0
        )
        cache.add(key, base, CACHE_TTL_SECONDS)
        cache.incr(key, delta)
    except ValueError:
        # Expired between the `add` and the `incr`. The next read re-seeds
        # from the table; nothing to do and nothing lost that a read cannot
        # recover.
        pass
    except Exception:
        logger.warning("could not seed cached counter %s", key, exc_info=True)
