"""Publishing to Redis, which is the only thing Django and the gateway share.

`apps/realtime` never touches Postgres. It learns that a message exists
because Django told it, on a channel, after the transaction committed —
`01-ARCHITECTURE.md` §8.

The envelope is the five fields from §3 and nothing more. `payload` is the
output of the *same DRF serializer* the REST endpoint returns, so its type is
already in the OpenAPI schema and already in the generated client. There is no
third hand-maintained description of a message anywhere.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import redis
from django.conf import settings

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1


def channel_for(user_id: int) -> str:
    """One durable channel per **recipient**, not per conversation.

    Django knows who the members are at publish time, so it addresses each of
    them directly. The gateway then subscribes a socket to exactly one durable
    channel — the one named by the ticket it just verified — and never has to
    answer "is this user allowed in that conversation?", which is a database
    question in a service that must not have a database.

    Costs one publish per member. That is two for a DM and at most
    thirty-two for a group.
    """
    return f"user.{user_id}"


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL)


def publish(
    *,
    conversation_id: int,
    recipient_ids: list[int],
    event_type: str,
    seq: int,
    payload: dict[str, Any],
) -> None:
    """Announce something durable to whoever is connected.

    **Call this after commit, never inside the transaction.** A rollback that
    has already delivered a socket event has told users about a message that
    does not exist, and no amount of client-side cleverness recovers from
    that. Every caller in `services.py` goes through `transaction.on_commit`.

    A publish failure is logged, not raised. The message is already durably
    written; failing the request now would tell the sender their message was
    lost when it was not. The client's next reconnect sync fetches it by `seq`,
    which is the same path that covers someone whose network dropped.
    """
    envelope = {
        "v": PROTOCOL_VERSION,
        "type": event_type,
        "conversation_id": str(conversation_id),
        "seq": seq,
        "payload": payload,
    }
    body = json.dumps(envelope)
    try:
        client = _client()
        pipeline = client.pipeline()
        for recipient_id in recipient_ids:
            pipeline.publish(channel_for(recipient_id), body)
        pipeline.execute()
    except redis.RedisError:
        logger.exception(
            "could not publish %s for conversation %s seq %s",
            event_type,
            conversation_id,
            seq,
        )
