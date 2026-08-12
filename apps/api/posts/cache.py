"""The feed cache — `01-ARCHITECTURE.md` §7, phase 2.

**A cache of post *ids*, not of posts.** The sorted set holds snowflakes
scored by themselves, and the rows are fetched from Postgres on every read.
That sounds like it defeats the purpose and does not: the expensive part of
the feed is the join and the sort across a fan-in of thousands of followees,
not `WHERE id IN (...)` against a primary key. Caching the ids removes the
expensive half and leaves the cheap half — and it means a post edited,
deleted, or hidden by a fresh block is *still* correct on the next read,
because the visibility rules run over the rows every time.

That last point is the whole reason this shape is safe. A cache of serialised
posts would have to be invalidated by every like, every caption edit, every
block and every account deletion; this one only has to be invalidated when
the *membership* of someone's feed changes, which is a much smaller set of
events.

**Fail open, always.** Every function here swallows Redis errors and reports
a miss. A feed cache that takes the site down when Redis blinks is worse than
no feed cache — the pull query underneath it is correct on its own and always
has been. §7 is explicit that pull is "always fresh, trivially correct, no
invalidation bugs" and good into the low millions of posts; this only exists
to save it work.
"""

from __future__ import annotations

import logging
from typing import cast

import redis
from django.conf import settings

logger = logging.getLogger(__name__)

#: §7: "Redis sorted set per user, 30-min TTL, invalidated on a followee's
#: new post." Thirty minutes bounds how long a bug here can be wrong for.
TTL_SECONDS = 30 * 60

#: How many ids to keep per user. Deep enough to cover several pages of
#: scrolling, shallow enough that ten thousand cached feeds is megabytes
#: rather than gigabytes. Past the end the reader falls through to Postgres,
#: which is exactly what someone scrolling that far deserves and nobody does.
MAX_ENTRIES = 300


def key(user_id: int) -> str:
    return f"feed:{user_id}"


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL)


def get_page(*, user_id: int, cursor: int | None, limit: int) -> list[int] | None:
    """Ids for one page, or None if this page is not cached.

    None and `[]` mean different things and the difference matters: `[]` is a
    cached, genuinely empty feed, while None is "ask Postgres". Collapsing
    them would make an empty cache indistinguishable from an empty feed and
    permanently serve nothing to a new account.
    """
    try:
        client = _client()
        if not client.exists(key(user_id)):
            return None

        # Scored by the id itself, so a cursor is a score bound rather than an
        # offset — the same reasoning as the SQL: nothing shifts or repeats
        # when a post arrives mid-scroll.
        top = f"({cursor}" if cursor is not None else "+inf"
        raw = client.zrevrangebyscore(key(user_id), top, "-inf", start=0, num=limit)
        # redis-py is typed for both sync and async clients, so the return is
        # a union the sync path can never actually hit.
        return [int(value) for value in cast("list[bytes]", raw)]
    except redis.RedisError:
        logger.warning("feed cache read failed for %s", user_id, exc_info=True)
        return None


def store(*, user_id: int, post_ids: list[int]) -> None:
    """Remember what the database just said.

    Only ever called with the *first* page. Caching deep pages would let a
    gap open in the middle of the set — page three cached while page two is
    not — and a sorted set cannot represent "I know these ids but not the
    ones between them".
    """
    if not post_ids:
        return

    try:
        client = _client()
        pipeline = client.pipeline()
        pipeline.delete(key(user_id))
        pipeline.zadd(key(user_id), {str(pk): pk for pk in post_ids})
        pipeline.zremrangebyrank(key(user_id), 0, -(MAX_ENTRIES + 1))
        pipeline.expire(key(user_id), TTL_SECONDS)
        pipeline.execute()
    except redis.RedisError:
        logger.warning("feed cache write failed for %s", user_id, exc_info=True)


def push(*, user_ids: list[int], post_id: int) -> None:
    """Add one post to feeds that already exist.

    **Only to feeds that already exist.** Creating a set here would build a
    one-post feed for someone who has not read in weeks, and the next reader
    would see exactly that one post and believe it — a cache must never invent
    a page it did not get from the database.
    """
    if not user_ids:
        return

    try:
        client = _client()
        pipeline = client.pipeline()
        for user_id in user_ids:
            # `xx=True` is what enforces the paragraph above.
            pipeline.zadd(key(user_id), {str(post_id): post_id}, xx=True)
            pipeline.zremrangebyrank(key(user_id), 0, -(MAX_ENTRIES + 1))
        pipeline.execute()
    except redis.RedisError:
        logger.warning("feed cache push failed for post %s", post_id, exc_info=True)


def drop(*, user_ids: list[int]) -> None:
    """Forget these feeds entirely.

    The blunt instrument, and the right one for anything that changes *which*
    accounts a feed draws from — a follow, an unfollow, a block. Rebuilding
    the set correctly would mean re-running the query it was meant to save;
    dropping it costs one miss.
    """
    if not user_ids:
        return

    try:
        _client().delete(*[key(user_id) for user_id in user_ids])
    except redis.RedisError:
        logger.warning("feed cache drop failed", exc_info=True)
