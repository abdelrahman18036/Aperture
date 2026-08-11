"""Reads for the counters app.

This app exists so that nothing else ever needs `.count()` on a request path.

Rule 9 is absolute, and the reason is arithmetic: a follower count on a
popular account is a sequential scan over millions of rows, and it renders on
every profile view. So counts are read from Redis, fall back to a single
batched query against the `counters` table, and are never computed live.

Reads here are **batched by design**. `for post in posts: like_count(post)` is
an N+1 dressed as a cache hit — a hundred Redis round trips is still a hundred
round trips. Every function below takes a collection.
"""

from __future__ import annotations

from django.core.cache import cache

from counters.models import Counter

#: Counters are derived state; a stale one is a cosmetic problem for a few
#: minutes, and a thundering herd is not. Long enough to matter, short enough
#: that a missed increment self-heals.
CACHE_TTL_SECONDS = 300


def cache_key(entity_type: str, entity_id: int, metric: str) -> str:
    return f"counter:{entity_type}:{entity_id}:{metric}"


def get_many(*, entity_type: str, entity_ids: list[int], metric: str) -> dict[int, int]:
    """Counts for many entities at once, Redis first.

    Missing entities read as 0 rather than being absent: a post with no likes
    has never had a counter row written, and every caller would otherwise
    need the same `or 0`.
    """
    if not entity_ids:
        return {}

    keys = {
        entity_id: cache_key(entity_type, entity_id, metric) for entity_id in entity_ids
    }
    cached: dict[str, int] = cache.get_many(list(keys.values()))

    counts: dict[int, int] = {}
    missing: list[int] = []
    for entity_id, key in keys.items():
        if key in cached:
            counts[entity_id] = cached[key]
        else:
            missing.append(entity_id)

    if missing:
        rows = Counter.objects.filter(
            entity_type=entity_type, entity_id__in=missing, metric=metric
        ).values_list("entity_id", "value")
        found = dict(rows)

        to_cache: dict[str, int] = {}
        for entity_id in missing:
            value = found.get(entity_id, 0)
            counts[entity_id] = value
            to_cache[keys[entity_id]] = value
        cache.set_many(to_cache, timeout=CACHE_TTL_SECONDS)

    return counts


def get_one(*, entity_type: str, entity_id: int, metric: str) -> int:
    """One count. Prefer `get_many` — this exists for genuinely single reads."""
    return get_many(entity_type=entity_type, entity_ids=[entity_id], metric=metric).get(
        entity_id, 0
    )


def get_metrics(
    *, entity_type: str, entity_id: int, metrics: list[str]
) -> dict[str, int]:
    """Several metrics for one entity — a profile header, typically."""
    return {
        metric: get_one(entity_type=entity_type, entity_id=entity_id, metric=metric)
        for metric in metrics
    }
