"""Tests for `calls.services`.

The two things worth pinning: Django decides who may be called, and the
LiveKit token it mints is scoped narrowly enough that holding one is not
interesting. Everything else about a call happens somewhere this module
cannot see.
"""

from __future__ import annotations

import time
from typing import Any

import jwt
import pytest
from django.conf import settings
from django.test import override_settings

from calls import events, services
from messaging import services as messaging_services
from messaging.models import Conversation
from users.models import Block, User

pytestmark = pytest.mark.django_db

NOW = 1_800_000_000.0


@pytest.fixture(autouse=True)
def _no_ringing(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture invites instead of reaching Redis."""
    published: list[dict[str, Any]] = []
    monkeypatch.setattr(
        events, "publish_invite", lambda **kwargs: published.append(kwargs)
    )
    return published


@pytest.fixture
def rings(_no_ringing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _no_ringing


@pytest.fixture
def alice(db: object) -> User:
    return User.objects.create_user("call-a@example.com", "call-a", "pw-call-1234")


@pytest.fixture
def bob(db: object) -> User:
    return User.objects.create_user("call-b@example.com", "call-b", "pw-call-1234")


@pytest.fixture
def carol(db: object) -> User:
    return User.objects.create_user("call-c@example.com", "call-c", "pw-call-1234")


@pytest.fixture
def dm(alice: User, bob: User) -> Conversation:
    return messaging_services.start_dm(initiator=alice, other=bob)


# ---------------------------------------------------------------------------
# Mode — a mesh is only cheap for two
# ---------------------------------------------------------------------------


def test_two_people_stay_peer_to_peer(alice: User, dm: Conversation) -> None:
    call = services.start_call(caller=alice, conversation=dm, now=NOW)

    assert call.mode == "p2p"
    # No room, so no token. Minting one anyway would hand out a credential
    # for an SFU nobody is going to connect to.
    assert call.livekit_token is None
    assert call.livekit_url is None


def test_three_people_go_through_the_sfu(alice: User, bob: User, carol: User) -> None:
    group = messaging_services.start_group(initiator=alice, others=[bob, carol])
    call = services.start_call(caller=alice, conversation=group, now=NOW)

    assert call.mode == "sfu"
    assert call.livekit_token is not None
    assert call.livekit_url == settings.LIVEKIT_URL


def test_the_threshold_is_where_the_mesh_stops_being_cheap() -> None:
    """Every participant in a mesh holds n-1 encoders and n-1 uplinks."""
    assert services.mode_for(2) == "p2p"
    assert services.mode_for(3) == "sfu"
    assert services.mode_for(30) == "sfu"


# ---------------------------------------------------------------------------
# Authorization — the part the gateway cannot do
# ---------------------------------------------------------------------------


def test_a_non_member_cannot_ring_a_conversation(carol: User, dm: Conversation) -> None:
    with pytest.raises(services.CallRejectedError):
        services.start_call(caller=carol, conversation=dm, now=NOW)


def test_a_block_stops_a_call_in_both_directions(
    alice: User, bob: User, dm: Conversation
) -> None:
    Block.objects.create(blocker=bob, blocked=alice)

    with pytest.raises(services.CallRejectedError):
        services.start_call(caller=alice, conversation=dm, now=NOW)
    with pytest.raises(services.CallRejectedError):
        services.start_call(caller=bob, conversation=dm, now=NOW)


def test_the_rejection_does_not_confirm_the_block(
    alice: User, bob: User, dm: Conversation
) -> None:
    Block.objects.create(blocker=bob, blocked=alice)
    with pytest.raises(services.CallRejectedError) as caught:
        services.start_call(caller=alice, conversation=dm, now=NOW)
    assert "block" not in str(caught.value).lower()


def test_joining_re_authorizes_rather_than_trusting_the_call_id(
    alice: User, bob: User, dm: Conversation
) -> None:
    """Knowing the id proves you were told; it does not prove you still may.

    Being blocked between the invite and the answer is precisely the window
    where trusting the id would be wrong.
    """
    call = services.start_call(caller=alice, conversation=dm, now=NOW)
    Block.objects.create(blocker=alice, blocked=bob)

    with pytest.raises(services.CallRejectedError):
        services.join_call(
            user=bob, conversation=dm, call_id=call.id, mode=call.mode, now=NOW
        )


def test_a_conversation_of_one_cannot_be_called(alice: User) -> None:
    solo = Conversation.objects.create(kind=Conversation.Kind.GROUP)
    from messaging.models import ConversationMember

    ConversationMember.objects.create(conversation=solo, user=alice)

    with pytest.raises(services.CallRejectedError):
        services.start_call(caller=alice, conversation=solo, now=NOW)


# ---------------------------------------------------------------------------
# Ringing
# ---------------------------------------------------------------------------


def test_everyone_but_the_caller_is_rung(
    alice: User, bob: User, carol: User, rings: list[dict[str, Any]]
) -> None:
    group = messaging_services.start_group(initiator=alice, others=[bob, carol])
    call = services.start_call(caller=alice, conversation=group, now=NOW)

    assert len(rings) == 1
    invite = rings[0]
    assert set(invite["recipient_ids"]) == {bob.pk, carol.pk}
    assert alice.pk not in invite["recipient_ids"]
    assert invite["call_id"] == call.id
    assert invite["mode"] == "sfu"


def test_nobody_is_rung_when_the_call_is_refused(
    carol: User, dm: Conversation, rings: list[dict[str, Any]]
) -> None:
    """Authorization runs before anything is published, not after."""
    with pytest.raises(services.CallRejectedError):
        services.start_call(caller=carol, conversation=dm, now=NOW)

    assert rings == []


# ---------------------------------------------------------------------------
# The call id is the capability
# ---------------------------------------------------------------------------


def test_every_call_gets_a_fresh_unguessable_id(alice: User, dm: Conversation) -> None:
    """The id names the signalling channel, so reuse would leak a whole call.

    A conversation-derived name would let anyone who had ever been in a call
    listen to the next one.
    """
    first = services.start_call(caller=alice, conversation=dm, now=NOW)
    second = services.start_call(caller=alice, conversation=dm, now=NOW)

    assert first.id != second.id
    # A snowflake, not a counter: guessing the next one must not be possible.
    assert first.id > 2**53


# ---------------------------------------------------------------------------
# The LiveKit token
# ---------------------------------------------------------------------------


def _claims(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.LIVEKIT_API_SECRET,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


def test_the_token_is_scoped_to_one_room_and_one_identity(
    alice: User, bob: User, carol: User
) -> None:
    group = messaging_services.start_group(initiator=alice, others=[bob, carol])
    call = services.start_call(caller=alice, conversation=group, now=NOW)

    assert call.livekit_token is not None
    claims = _claims(call.livekit_token)

    assert claims["sub"] == str(alice.pk)
    assert claims["video"]["room"] == f"call-{call.id}"
    assert claims["video"]["roomJoin"] is True


def test_the_token_grants_nothing_beyond_joining(
    alice: User, bob: User, carol: User
) -> None:
    """A participant token that can create or administer rooms is a mistake.

    `room_create` would let a browser open arbitrary rooms on the SFU;
    `room_admin` would let it evict the people in this one.
    """
    group = messaging_services.start_group(initiator=alice, others=[bob, carol])
    call = services.start_call(caller=alice, conversation=group, now=NOW)

    assert call.livekit_token is not None
    grants = _claims(call.livekit_token)["video"]

    assert not grants.get("roomCreate", False)
    assert not grants.get("roomAdmin", False)
    assert not grants.get("roomList", False)
    assert not grants.get("recorder", False)


def test_the_token_expires(alice: User, bob: User, carol: User) -> None:
    group = messaging_services.start_group(initiator=alice, others=[bob, carol])
    call = services.start_call(caller=alice, conversation=group, now=NOW)

    assert call.livekit_token is not None
    claims = _claims(call.livekit_token)

    lifetime = claims["exp"] - claims["nbf"]
    assert lifetime <= settings.LIVEKIT_TOKEN_TTL_SECONDS + 1
    # And it is genuinely in the future relative to a real clock, since the
    # SDK stamps this itself rather than taking our `now`.
    assert claims["exp"] > time.time()


def test_two_participants_get_different_identities(
    alice: User, bob: User, carol: User
) -> None:
    """LiveKit evicts a duplicate identity, so a shared one drops someone."""
    group = messaging_services.start_group(initiator=alice, others=[bob, carol])
    call = services.start_call(caller=alice, conversation=group, now=NOW)
    joined = services.join_call(
        user=bob, conversation=group, call_id=call.id, mode=call.mode, now=NOW
    )

    assert call.livekit_token is not None
    assert joined.livekit_token is not None
    assert _claims(call.livekit_token)["sub"] != _claims(joined.livekit_token)["sub"]
    # Same room, though — otherwise they are in two separate calls.
    assert (
        _claims(call.livekit_token)["video"]["room"]
        == _claims(joined.livekit_token)["video"]["room"]
    )


# ---------------------------------------------------------------------------
# ICE servers
# ---------------------------------------------------------------------------


def test_every_call_carries_tls_on_443(alice: User, dm: Conversation) -> None:
    """§9's non-negotiable, reaching the client this time rather than a unit."""
    call = services.start_call(caller=alice, conversation=dm, now=NOW)

    urls = [url for server in call.ice_servers for url in server["urls"]]
    assert any(url.startswith("turns:") and ":443" in url for url in urls)


def test_the_turn_credential_belongs_to_the_caller(
    alice: User, bob: User, dm: Conversation
) -> None:
    theirs = services.start_call(caller=alice, conversation=dm, now=NOW)
    ours = services.join_call(
        user=bob, conversation=dm, call_id=theirs.id, mode="p2p", now=NOW
    )

    def username(call: services.Call) -> str:
        for server in call.ice_servers:
            if "username" in server:
                return server["username"]
        raise AssertionError("no TURN credential in the ICE servers")

    assert username(theirs).endswith(f":{alice.pk}")
    assert username(ours).endswith(f":{bob.pk}")


@override_settings(STUN_URLS=("stun:stun.example.com:3478",))
def test_configured_stun_servers_reach_the_client(
    alice: User, dm: Conversation
) -> None:
    call = services.start_call(caller=alice, conversation=dm, now=NOW)

    urls = [url for server in call.ice_servers for url in server["urls"]]
    assert "stun:stun.example.com:3478" in urls
