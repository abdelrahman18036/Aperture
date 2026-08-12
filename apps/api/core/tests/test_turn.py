"""Tests for `core.turn`.

No database, no clock, no settings — `now` is a parameter, which is the whole
reason this module is in `core/`.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from core.turn import (
    DEFAULT_TTL_SECONDS,
    build_credential,
    build_ice_servers,
    is_expired,
)

SECRET = "a-development-turn-secret-long-enough"
NOW = 1_800_000_000.0


def test_the_password_is_the_hmac_coturn_will_recompute() -> None:
    """The entire scheme, asserted rather than assumed.

    coturn derives the same digest from its own copy of the secret. If this
    ever stops matching, every call silently falls back to direct connections
    and fails on exactly the networks TURN exists for.
    """
    credential = build_credential(user_id=42, secret=SECRET, now=NOW)

    expected = base64.b64encode(
        hmac.new(
            SECRET.encode("utf-8"), credential.username.encode("utf-8"), hashlib.sha1
        ).digest()
    ).decode("ascii")

    assert credential.password == expected


def test_the_username_carries_the_expiry_and_the_user() -> None:
    credential = build_credential(user_id=42, secret=SECRET, now=NOW, ttl_seconds=600)

    assert credential.username == f"{int(NOW) + 600}:42"
    assert credential.expires_at == int(NOW) + 600


def test_the_default_lifetime_is_hours_not_minutes() -> None:
    """A credential has to outlive placing a call, not just fetching a page."""
    credential = build_credential(user_id=1, secret=SECRET, now=NOW)
    assert credential.expires_at - int(NOW) == DEFAULT_TTL_SECONDS
    assert DEFAULT_TTL_SECONDS >= 60 * 60


def test_a_credential_expires() -> None:
    credential = build_credential(user_id=1, secret=SECRET, now=NOW, ttl_seconds=60)

    assert not is_expired(credential, now=NOW)
    assert not is_expired(credential, now=NOW + 59)
    assert is_expired(credential, now=NOW + 60)
    assert is_expired(credential, now=NOW + 600)


def test_two_users_never_share_a_credential() -> None:
    """Attribution: relayed bandwidth is a real cost and someone owns it."""
    a = build_credential(user_id=1, secret=SECRET, now=NOW)
    b = build_credential(user_id=2, secret=SECRET, now=NOW)

    assert a.username != b.username
    assert a.password != b.password


def test_a_different_secret_yields_a_credential_coturn_would_reject() -> None:
    ours = build_credential(user_id=1, secret=SECRET, now=NOW)
    theirs = build_credential(user_id=1, secret="some-other-secret", now=NOW)

    assert ours.username == theirs.username
    assert ours.password != theirs.password


def test_an_empty_secret_is_refused() -> None:
    """Failing here beats minting credentials nothing will accept."""
    with pytest.raises(ValueError, match="TURN secret"):
        build_credential(user_id=1, secret="", now=NOW)


# ---------------------------------------------------------------------------
# The ICE server list
# ---------------------------------------------------------------------------


def test_tls_on_443_is_always_offered() -> None:
    """§9's non-negotiable, as a test.

    Without a `turns:` entry on 443 the call rate sits near 70% on networks
    that drop UDP, and the symptom looks like a code bug rather than a
    missing transport.
    """
    credential = build_credential(user_id=1, secret=SECRET, now=NOW)
    servers = build_ice_servers(credential=credential, turn_host="turn.example.com")

    urls = [url for server in servers for url in server["urls"]]
    assert "turns:turn.example.com:443?transport=tcp" in urls


def test_every_transport_is_offered() -> None:
    """UDP, TCP and TLS. The browser races them; coverage costs nothing."""
    credential = build_credential(user_id=1, secret=SECRET, now=NOW)
    servers = build_ice_servers(credential=credential, turn_host="turn.example.com")

    urls = [url for server in servers for url in server["urls"]]
    assert any(url.startswith("turn:") and "udp" in url for url in urls)
    assert any(url.startswith("turn:") and "tcp" in url for url in urls)
    assert any(url.startswith("turns:") for url in urls)


def test_every_turn_entry_carries_the_credential() -> None:
    """A `turns:` URL with no credential is a relay nobody can use."""
    credential = build_credential(user_id=7, secret=SECRET, now=NOW)
    servers = build_ice_servers(credential=credential, turn_host="turn.example.com")

    for server in servers:
        if any(url.startswith(("turn:", "turns:")) for url in server["urls"]):
            assert server["username"] == credential.username
            assert server["credential"] == credential.password


def test_stun_is_listed_first_when_given() -> None:
    """Cheapest transport first: a direct connection relays nothing at all."""
    credential = build_credential(user_id=1, secret=SECRET, now=NOW)
    servers = build_ice_servers(
        credential=credential,
        turn_host="turn.example.com",
        stun_urls=("stun:stun.example.com:3478",),
    )

    assert servers[0]["urls"] == ["stun:stun.example.com:3478"]
    assert "username" not in servers[0]


def test_no_stun_entry_when_none_configured() -> None:
    credential = build_credential(user_id=1, secret=SECRET, now=NOW)
    servers = build_ice_servers(credential=credential, turn_host="turn.example.com")

    urls = [url for server in servers for url in server["urls"]]
    assert not any(url.startswith("stun:") for url in urls)
