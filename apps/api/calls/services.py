"""Writes for the calls app.

Calls persist nothing, so there is no `.save()` here — but the authorization
does live here, and that is the point of the module.

**What Django does and does not do in a call.** It answers "may these people
talk?" and hands out the credentials that follow from the answer: a LiveKit
room token for group calls, time-limited TURN credentials for every call. It
never sees an offer, an answer or an ICE candidate — those are ephemeral, go
over the socket, and never reach Postgres (`01-ARCHITECTURE.md` §8, §9).

**Why initiation is HTTP and signalling is not.** Ringing someone is an
authorization decision: are they in this conversation, has either blocked the
other. The gateway cannot answer that — it has no database, by rule 6. So
Django decides, and then hands the participants a `call_id` they use as a
channel name. That id is an unguessable snowflake, and receiving it *is* the
capability: the gateway can fan out signalling on `call.{id}` without knowing
who anyone is, because nobody else could name the channel. Offers and answers
never touch Django, and the gateway never has a question it cannot answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from django.conf import settings
from django.db.models import Q
from livekit.api import AccessToken, VideoGrants

from calls import events
from core.ids import snowflake
from core.turn import IceServer, build_credential, build_ice_servers
from messaging.models import Conversation, ConversationMember
from users.models import Block, User

CallMode = Literal["p2p", "sfu"]


class CallRejectedError(Exception):
    """The call cannot be placed. The message is safe to show a user."""


@dataclass(frozen=True)
class Call:
    """A call in flight. Nothing here is written down anywhere."""

    id: int
    conversation_id: int
    mode: CallMode
    participant_ids: list[int]
    ice_servers: list[IceServer]
    #: Only for `sfu` calls. `p2p` needs no room and gets no token.
    livekit_url: str | None
    livekit_token: str | None


def _room_name(call_id: int) -> str:
    """One room per call, never per conversation.

    A room named after the conversation would let a token minted for a call
    last week rejoin a call happening now.
    """
    return f"call-{call_id}"


def mode_for(participant_count: int) -> CallMode:
    """Peer-to-peer up to the SFU threshold, the SFU above it.

    A mesh costs every participant `n-1` encoders and `n-1` uplinks, so it
    stops being the cheap option almost immediately. Two people is the case
    where the mesh *is* the whole call and an SFU would only add a hop.
    """
    return "sfu" if participant_count >= settings.SFU_THRESHOLD else "p2p"


def _ice_servers_for(user: User, *, now: float) -> list[IceServer]:
    credential = build_credential(
        user_id=user.pk, secret=settings.TURN_STATIC_AUTH_SECRET, now=now
    )
    return build_ice_servers(
        credential=credential,
        turn_host=settings.TURN_HOST,
        turn_tls_port=settings.TURN_TLS_PORT,
        turn_udp_port=settings.TURN_UDP_PORT,
        stun_urls=settings.STUN_URLS,
    )


def mint_room_token(*, user: User, call_id: int) -> str:
    """A LiveKit token, scoped to one room and one identity.

    Minted here rather than in the browser or the gateway — §9 says so twice,
    and the reason is that the signing secret authorises *anything* on the
    SFU. A browser holding it could open rooms, subscribe to other people's
    tracks, and record them.
    """
    return (
        AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        .with_identity(str(user.pk))
        .with_name(user.username)
        .with_ttl(timedelta(seconds=settings.LIVEKIT_TOKEN_TTL_SECONDS))
        .with_grants(
            VideoGrants(
                room_join=True,
                room=_room_name(call_id),
                can_publish=True,
                can_subscribe=True,
                # No `room_create` and no admin: the server creates the room on
                # first join, and handing either out lets a participant open
                # arbitrary rooms or evict the people in this one.
                room_admin=False,
                room_list=False,
            )
        )
        .to_jwt()
    )


def _authorize(*, caller: User, conversation: Conversation) -> list[ConversationMember]:
    """Membership and blocks, checked once, before anyone's phone rings."""
    members = list(
        ConversationMember.objects.filter(conversation=conversation).select_related(
            "user"
        )
    )
    if not any(member.user_id == caller.pk for member in members):
        raise CallRejectedError("You are not in that conversation.")

    others = [member.user for member in members if member.user_id != caller.pk]
    if not others:
        raise CallRejectedError("There is nobody to call.")

    blocked = Block.objects.filter(
        Q(blocker=caller, blocked__in=others) | Q(blocker__in=others, blocked=caller)
    ).exists()
    if blocked:
        # Deliberately vague, the same as messaging: confirming a block
        # reveals it.
        raise CallRejectedError("That account is unavailable.")

    return members


def start_call(*, caller: User, conversation: Conversation, now: float) -> Call:
    """Ring everyone else in a conversation.

    The `call_id` handed back is the capability the whole design rests on: a
    fresh snowflake, delivered only to people this function has just
    authorized, and the name of the channel their signalling rides on.
    """
    members = _authorize(caller=caller, conversation=conversation)

    call_id = snowflake()
    participant_ids = [member.user_id for member in members]
    mode = mode_for(len(participant_ids))
    sfu = mode == "sfu"

    call = Call(
        id=call_id,
        conversation_id=conversation.pk,
        mode=mode,
        participant_ids=participant_ids,
        ice_servers=_ice_servers_for(caller, now=now),
        livekit_url=settings.LIVEKIT_URL if sfu else None,
        livekit_token=mint_room_token(user=caller, call_id=call_id) if sfu else None,
    )

    # Straight to Redis, with no `on_commit`: nothing was written, so there is
    # no transaction to wait for. Rule 11 is about never announcing a row that
    # might roll back, and a call has no row.
    events.publish_invite(
        call_id=call_id,
        conversation_id=conversation.pk,
        caller=caller,
        recipient_ids=[pk for pk in participant_ids if pk != caller.pk],
        mode=mode,
    )

    return call


def join_call(
    *, user: User, conversation: Conversation, call_id: int, mode: CallMode, now: float
) -> Call:
    """Take the credentials for a call you were invited to.

    Re-authorizes rather than trusting the `call_id`. Knowing the id proves
    somebody told you about the call; it does not prove you are still in the
    conversation, and being removed between the invite and the join is exactly
    when that difference matters.
    """
    members = _authorize(caller=user, conversation=conversation)
    participant_ids = [member.user_id for member in members]
    sfu = mode == "sfu"

    return Call(
        id=call_id,
        conversation_id=conversation.pk,
        mode=mode,
        participant_ids=participant_ids,
        ice_servers=_ice_servers_for(user, now=now),
        livekit_url=settings.LIVEKIT_URL if sfu else None,
        livekit_token=mint_room_token(user=user, call_id=call_id) if sfu else None,
    )
