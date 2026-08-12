"""Publishing domain events to whoever is connected.

`messaging/events.py` has done this since Phase 6, but only for messages —
its signature carries a `conversation_id` and a `seq`, because a message has
both. A post does not, and a story does not, so everything outside messaging
had no way to reach a socket and every screen in the product had to be
refreshed to see anything new.

This is the general form. It lives in `config/` rather than in an app for the
same reason `config/fields.py` and `config/converters.py` do: it is plumbing
that several apps need and none of them owns. It cannot live in `core/`,
which imports no Django — this needs `settings.REDIS_URL`.

The channel name and protocol version come from `messaging.events`, which
already owns them and which the gateway is written against. Two definitions of
a channel name is one too many.

**Publish after commit, never inside the transaction.** Rule 11, and the
reasoning is unchanged: a rollback that has already announced a post has told
people about a row that does not exist.

**A publish failure is logged, not raised.** The row is already durably
written. Failing the request now would tell somebody their post did not
happen when it did, and the next fetch shows it anyway.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis
from django.conf import settings

from messaging.events import PROTOCOL_VERSION, channel_for

logger = logging.getLogger(__name__)

#: How many people one event is pushed to.
#:
#: `01-ARCHITECTURE.md` §7 warns about fanout on a large account, and this is
#: where it would bite: an account with a million followers would otherwise
#: mean a million `PUBLISH` commands inside one request's `on_commit`. The cap
#: means a very large account's followers do not all get a live update — they
#: get it on their next fetch, which is what happens today for everybody. The
#: alternative is a fanout worker, which §7 puts behind a measurement nobody
#: has taken yet.
MAX_RECIPIENTS = 5_000


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL)


def publish_to_users(
    *, user_ids: list[int], event_type: str, payload: dict[str, Any]
) -> None:
    """Push one event to each user's own channel.

    The channel a client cannot name and cannot opt out of — so unlike the
    ephemeral conversation channels, membership here is decided entirely by
    this call and never by anything the browser says.
    """
    if not user_ids:
        return

    envelope = json.dumps(
        {
            "v": PROTOCOL_VERSION,
            "type": event_type,
            # Present so one envelope shape covers messaging too, where it is
            # the conversation. Empty for anything that is not in one.
            "conversation_id": "",
            "seq": 0,
            "payload": payload,
        }
    )

    try:
        client = _client()
        pipeline = client.pipeline()
        for user_id in user_ids[:MAX_RECIPIENTS]:
            pipeline.publish(channel_for(user_id), envelope)
        pipeline.execute()
    except redis.RedisError:
        logger.exception("failed to publish %s to %s users", event_type, len(user_ids))
