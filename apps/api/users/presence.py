"""Who is online, read from the keys the gateway writes.

**The gateway has been writing presence since Phase 6 and nothing has ever
read it.** `apps/realtime/src/presence.ts` sets `presence:{user_id}` with a
75-second TTL and refreshes it on every heartbeat, and `isOnline` there has no
callers at all. The consequence was visible in two places: the conversation
header showed "Live" whenever *your own* socket was open, which is always, and
placing a call to somebody who was not connected sat on "Connecting" forever
with nothing to say why.

This reads the same keys. It does not write them — presence belongs to
whichever process is holding the socket, and a second writer would be a second
opinion about a fact only one of them can observe.

Deliberately not a database table. §8: "Presence is Redis keys with a TTL,
refreshed by heartbeat." A presence record that survives a restart is worse
than none, because it claims somebody is online when the process that knew
about them is gone.
"""

from __future__ import annotations

from datetime import UTC, datetime

import redis
from django.conf import settings

#: Must match `apps/realtime/src/presence.ts`. Two processes agreeing on a key
#: name by convention is the seam here; there is no shared code between a
#: Python service and a TypeScript one, which is the cost of the split.
KEY_PREFIX = "presence:"


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL)


def online_ids(user_ids: list[int]) -> set[int]:
    """Which of these are connected right now.

    Batched into one `MGET`, because the caller is always a list — a
    conversation's members, a tray of authors — and one round trip per person
    is the same N+1 in a different protocol.

    **Fails closed to "nobody is online".** Every caller treats presence as a
    hint, and a Redis hiccup that reported everyone online would put a "Live"
    dot next to people who are not there — which is worse than a dot that is
    briefly missing.
    """
    if not user_ids:
        return set()

    try:
        client = _client()
        values = client.mget([f"{KEY_PREFIX}{user_id}" for user_id in user_ids])
    except redis.RedisError:
        return set()

    return {
        user_id
        for user_id, value in zip(user_ids, values, strict=True)
        if value is not None
    }


def is_online(user_id: int) -> bool:
    """One person. Prefer `online_ids` — this exists for genuinely single reads."""
    return user_id in online_ids([user_id])


#: Written by the gateway alongside the presence key, with no TTL — the
#: point of "last seen" is that it outlives the thing that says you are here.
LAST_SEEN_PREFIX = "last-seen:"


def last_seen(user_ids: list[int]) -> dict[int, datetime]:
    """When each of these was last connected, for those we have a record of.

    Milliseconds since the epoch on the wire, because that is what
    `Date.now()` writes on the other side of the seam. Converted here so
    nothing downstream has to know that.
    """
    if not user_ids:
        return {}

    try:
        client = _client()
        values = client.mget([f"{LAST_SEEN_PREFIX}{user_id}" for user_id in user_ids])
    except redis.RedisError:
        return {}

    seen: dict[int, datetime] = {}
    for user_id, raw in zip(user_ids, values, strict=True):
        if raw is None:
            continue
        try:
            millis = int(raw)
        except (TypeError, ValueError):
            continue
        seen[user_id] = datetime.fromtimestamp(millis / 1000, tz=UTC)
    return seen
