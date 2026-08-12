"""DRF shapes for the calls app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.

These feed drf-spectacular, which generates `packages/api-client`. A change
here is a change to the frontend's types -- regenerate in the same commit.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from config.fields import SnowflakeField


class IceServerSerializer(serializers.Serializer[dict[str, Any]]):
    """One `RTCIceServer`, handed to the browser verbatim.

    `credential` is a TURN password that expires — see `core/turn.py`. It is
    not a secret worth protecting for long, which is exactly why it is safe to
    send here at all.
    """

    urls = serializers.ListField(child=serializers.CharField(), read_only=True)
    username = serializers.CharField(read_only=True, required=False)
    credential = serializers.CharField(read_only=True, required=False)


class CallSerializer(serializers.Serializer[dict[str, Any]]):
    """Everything a client needs to join a call and nothing it does not."""

    id = SnowflakeField(read_only=True)
    conversation_id = SnowflakeField(read_only=True)
    #: `p2p` or `sfu`. The client picks its transport from this, and the
    #: server decides it — a browser choosing for itself could insist on a
    #: mesh for thirty people.
    mode = serializers.CharField(read_only=True)
    participant_ids = serializers.ListField(
        child=serializers.CharField(), read_only=True
    )
    ice_servers = IceServerSerializer(many=True, read_only=True)
    #: Both null for a `p2p` call: there is no room, so there is no token.
    livekit_url = serializers.CharField(read_only=True, allow_null=True)
    livekit_token = serializers.CharField(read_only=True, allow_null=True)


class StartCallSerializer(serializers.Serializer[dict[str, Any]]):
    """Which conversation to ring."""

    conversation_id = serializers.CharField()


class JoinCallSerializer(serializers.Serializer[dict[str, Any]]):
    """Answering an invite.

    `call_id` and `mode` come back from the invite the callee received over
    the socket. Neither is trusted for authorization — `join_call` re-checks
    membership and blocks against the conversation before minting anything.
    """

    conversation_id = serializers.CharField()
    call_id = serializers.CharField()
    mode = serializers.ChoiceField(choices=["p2p", "sfu"])


def call_payload(call: Any) -> dict[str, Any]:
    """Flatten a `services.Call` into the shape `CallSerializer` expects.

    The result is fed *through* the serializer rather than returned directly.
    That is what makes `SnowflakeField` run — and returning the dict raw was a
    real bug: `id` went out as a JSON number, which above 2^53 `JSON.parse`
    rounds, and a rounded call id names a signalling channel nobody is
    listening on. It also meant the response and the schema drf-spectacular
    documents were two different shapes.
    """
    return {
        "id": call.id,
        "conversation_id": call.conversation_id,
        "mode": call.mode,
        "participant_ids": [str(pk) for pk in call.participant_ids],
        "ice_servers": call.ice_servers,
        "livekit_url": call.livekit_url,
        "livekit_token": call.livekit_token,
    }
