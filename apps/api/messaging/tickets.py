"""Signing socket tickets.

The claims come from `core.tickets`; this adds the key and the algorithm.

**HS256, pinned on both sides.** Django only ever signs and the gateway only
ever verifies, so there is no path here that parses an attacker-supplied
token — but the algorithm is named explicitly anyway, because `alg: none` and
algorithm confusion are what happens when it is not.
"""

from __future__ import annotations

import time

import jwt
from django.conf import settings

from core.tickets import build_claims

ALGORITHM = "HS256"


def mint(*, user_id: int) -> tuple[str, int]:
    """A ticket for this user, and how long it lasts.

    The secret is the one thing Django and `apps/realtime` share, and it lives
    only in the environment — `01-ARCHITECTURE.md` §12.
    """
    ttl = settings.REALTIME_TICKET_TTL_SECONDS
    claims = build_claims(user_id=user_id, issued_at=time.time(), ttl_seconds=ttl)
    token = jwt.encode(claims, settings.REALTIME_TICKET_SECRET, algorithm=ALGORITHM)
    return token, ttl
