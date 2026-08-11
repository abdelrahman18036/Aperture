"""Socket ticket claims — the shape, with no signing and no settings.

Django mints a short-lived signed ticket; the Node gateway verifies it with
the shared secret and never calls back. Stateless, no database lookup on
connect, and a leaked ticket expires in a minute —
`01-ARCHITECTURE.md` §8.

This module builds the claim set and nothing else. Signing needs a key, and a
key comes from settings, so that lives in `messaging/tickets.py`. Keeping the
claims here means the *shape* of a ticket — including how short its life is —
is testable without a clock, a key or a database.
"""

from __future__ import annotations

from typing import Any

#: Sixty seconds, per §8. Long enough to survive a slow page load and a
#: WebSocket handshake, short enough that a ticket captured from a URL or a
#: log is worthless by the time anyone reads it.
DEFAULT_TTL_SECONDS = 60


def build_claims(
    *, user_id: int, issued_at: float, ttl_seconds: int = DEFAULT_TTL_SECONDS
) -> dict[str, Any]:
    """The claims Django signs and the gateway verifies.

    `sub` is a **string**, per RFC 7519 and for the same reason every id
    crosses the wire as one: a snowflake exceeds 2^53 and JavaScript would
    round it. The gateway reads `sub` straight into a JS string.

    Deliberately minimal. A ticket says who you are and until when — it grants
    no scopes and names no conversations, because the gateway checks
    membership through Django rather than trusting a token to carry it.
    """
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive")

    return {
        "sub": str(user_id),
        "iat": int(issued_at),
        "exp": int(issued_at) + ttl_seconds,
    }
