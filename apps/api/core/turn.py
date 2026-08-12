"""TURN credentials, and why they are not a password.

`01-ARCHITECTURE.md` §9 calls TURN over **TLS on 443** non-negotiable:
Egyptian ISPs and effectively every corporate firewall drop UDP, and without
a TCP/443 fallback the connection rate quietly sits near 70% while the code
gets blamed. A relay that everyone can use is therefore load-bearing — which
also makes it worth stealing.

So the browser never receives a static TURN password. It receives a
credential that expires, derived from a secret it never sees:

    username = "<unix-expiry>:<user-id>"
    password = base64(HMAC-SHA1(static-auth-secret, username))

coturn recomputes the same HMAC from its own copy of the secret and compares.
No database lookup, no per-user rows, no revocation list — the credential
simply stops working. This is coturn's `use-auth-secret` mechanism, the same
scheme every hosted TURN provider exposes, and it is why
`infra/coturn/turnserver.conf` does not hold a user list.

Pure by rule 5: no Django import, no settings, no clock of its own. The
caller passes `now`, which is what makes expiry testable without freezing
time.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from dataclasses import dataclass
from typing import NotRequired, TypedDict

#: Long enough to place a call and have it run; short enough that a captured
#: credential is worthless by the time anyone gets to it. A credential only
#: has to survive *starting* a call — coturn keeps an established allocation
#: alive past expiry, so a long call does not drop when the clock runs out.
DEFAULT_TTL_SECONDS = 12 * 60 * 60


class IceServer(TypedDict):
    """One entry of WebRTC's `iceServers`, typed rather than `dict[str, Any]`.

    The optional fields are genuinely optional: a STUN server takes no
    credential, and sending one would be meaningless rather than harmless.
    """

    urls: list[str]
    username: NotRequired[str]
    credential: NotRequired[str]


@dataclass(frozen=True)
class TurnCredential:
    """What the browser puts in an `RTCIceServer`."""

    username: str
    password: str
    expires_at: int


def build_credential(
    *, user_id: int, secret: str, now: float, ttl_seconds: int = DEFAULT_TTL_SECONDS
) -> TurnCredential:
    """Mint a credential coturn will accept until it expires.

    The user id rides in the username so a relay log can attribute traffic to
    an account — which matters, because relayed media is the one WebRTC cost
    that scales linearly with usage and someone will eventually need to know
    whose.
    """
    if not secret:
        raise ValueError("a TURN secret is required")

    expires_at = int(now) + ttl_seconds
    username = f"{expires_at}:{user_id}"
    digest = hmac.new(
        secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1
    ).digest()
    return TurnCredential(
        username=username,
        password=base64.b64encode(digest).decode("ascii"),
        expires_at=expires_at,
    )


def is_expired(credential: TurnCredential, *, now: float) -> bool:
    return credential.expires_at <= int(now)


def build_ice_servers(
    *,
    credential: TurnCredential,
    turn_host: str,
    turn_tls_port: int = 443,
    turn_udp_port: int = 3478,
    stun_urls: tuple[str, ...] = (),
) -> list[IceServer]:
    """The `iceServers` array, in the order that makes a call connect.

    Order matters less than coverage, but coverage is the whole point here.
    Three transports, cheapest first:

    1. **STUN** — no relay at all. Free, and enough for most home networks.
    2. **TURN over UDP** — a relay, but the fast kind.
    3. **TURN over TLS on 443** — indistinguishable from HTTPS to a firewall,
       and the only one that survives a network which drops UDP outright.

    The third is the one this exists for. A browser tries them in parallel and
    keeps whichever pair succeeds, so including all three costs nothing and
    removes the failure mode where a call works everywhere except the places
    people actually make calls from.
    """
    servers: list[IceServer] = []

    if stun_urls:
        servers.append({"urls": list(stun_urls)})

    servers.append(
        {
            "urls": [
                f"turn:{turn_host}:{turn_udp_port}?transport=udp",
                f"turn:{turn_host}:{turn_udp_port}?transport=tcp",
            ],
            "username": credential.username,
            "credential": credential.password,
        }
    )
    servers.append(
        {
            "urls": [f"turns:{turn_host}:{turn_tls_port}?transport=tcp"],
            "username": credential.username,
            "credential": credential.password,
        }
    )

    return servers
