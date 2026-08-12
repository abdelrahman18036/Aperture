"""The one call event Django publishes: the invite.

Everything else about a call — offers, answers, ICE candidates, hangups — is
ephemeral, rides the socket, and never reaches Django at all. This module
exists because *ringing* is the one part that needs authorization, and
authorization needs a database.

The invite goes to each recipient's own durable channel, the same
`user.{id}` the messaging events use. That is what lets it arrive whether or
not the callee happens to be looking at the conversation — which is the whole
difference between a phone ringing and a missed call.
"""

from __future__ import annotations

import json
import logging

import redis
from django.conf import settings

from messaging.events import PROTOCOL_VERSION, channel_for
from users.models import User

logger = logging.getLogger(__name__)

#: The invite. Named alongside `messaging.events.EVENT_TYPES` rather than in
#: it, because the two travel different envelopes: a message event carries a
#: `seq`, and a call has nothing to sequence.
EVENT_TYPE = "call.incoming"


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL)


def publish_invite(
    *,
    call_id: int,
    conversation_id: int,
    caller: User,
    recipient_ids: list[int],
    mode: str,
) -> None:
    """Ring everyone except the caller.

    The `call_id` in this payload is a capability: it names the channel the
    call's signalling will ride on, and only the people addressed here ever
    learn it. Ids cross the wire as strings — a snowflake above 2^53 loses
    precision in `JSON.parse`, and a rounded call id names a channel nobody is
    listening to.

    A publish failure is logged, not raised. The caller's own call is already
    set up and their UI is already ringing out; failing the request would tell
    them the call could not be placed when what actually happened is that one
    phone did not ring.
    """
    body = json.dumps(
        {
            "v": PROTOCOL_VERSION,
            "type": EVENT_TYPE,
            "call_id": str(call_id),
            "conversation_id": str(conversation_id),
            "mode": mode,
            "caller": {"id": str(caller.pk), "username": caller.username},
        }
    )

    try:
        client = _client()
        pipeline = client.pipeline()
        for recipient_id in recipient_ids:
            pipeline.publish(channel_for(recipient_id), body)
        pipeline.execute()
    except redis.RedisError:
        logger.exception("could not ring call %s", call_id)
