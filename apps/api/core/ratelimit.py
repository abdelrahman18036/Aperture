"""Token bucket — the arithmetic, with nothing else attached.

No Redis, no Django, no clock of its own. Every input is a parameter, so the
whole policy is exhaustively testable in milliseconds and the storage adapter
in `moderation/` holds no decisions.

Why a token bucket rather than a fixed window: a fixed window lets someone
spend their entire allowance in the last second of one window and again in the
first second of the next, which is a 2x burst exactly at the boundary. A bucket
refills continuously, so the burst is whatever `capacity` says and nothing
larger.

`01-ARCHITECTURE.md` §11: DRF's built-in throttling is a starting point but is
per-view and coarse; the bucket belongs in `core/` where it can be tested.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

__all__ = [
    "LIMITS",
    "Bucket",
    "Decision",
    "consume",
]


@dataclass(frozen=True, slots=True)
class Bucket:
    """A limit's shape.

    `capacity` is the burst: how many actions are allowed back to back from a
    full bucket. `refill_per_second` is the sustained rate.
    """

    capacity: int
    refill_per_second: float

    def __post_init__(self) -> None:
        if self.capacity <= 0:
            raise ValueError("capacity must be positive")
        if self.refill_per_second <= 0:
            raise ValueError("refill_per_second must be positive")

    @property
    def seconds_to_full(self) -> float:
        return self.capacity / self.refill_per_second


@dataclass(frozen=True, slots=True)
class Decision:
    """What to do, and what to store back."""

    allowed: bool
    #: Tokens left after this decision. Persist alongside `at`.
    tokens: float
    #: The timestamp this state is correct as of.
    at: float
    #: Seconds until one token is available. Zero when allowed.
    retry_after: float

    @property
    def retry_after_seconds(self) -> int:
        """Whole seconds, rounded up — the `Retry-After` header wants an int.

        Rounded up rather than down: telling a client to retry in 0 seconds
        when it will still be refused is how you get a hot retry loop.
        """
        import math

        return max(1, math.ceil(self.retry_after)) if self.retry_after > 0 else 0


def consume(
    *,
    bucket: Bucket,
    tokens: float,
    last_seen: float,
    now: float,
    cost: float = 1.0,
) -> Decision:
    """Refill for elapsed time, then decide.

    `tokens`/`last_seen` are the stored state; pass `bucket.capacity` and `now`
    for a bucket that has never been used.

    Clock going backwards is treated as no elapsed time rather than as
    negative refill — a drifting clock must not be able to *drain* a bucket.
    """
    elapsed = max(0.0, now - last_seen)
    refilled = min(bucket.capacity, tokens + elapsed * bucket.refill_per_second)

    if refilled >= cost:
        return Decision(allowed=True, tokens=refilled - cost, at=now, retry_after=0.0)

    shortfall = cost - refilled
    return Decision(
        allowed=False,
        # State is still advanced: the refill happened whether or not the
        # request was allowed. Not advancing it would make every refused
        # request recompute from an older timestamp.
        tokens=refilled,
        at=now,
        retry_after=shortfall / bucket.refill_per_second,
    )


# ---------------------------------------------------------------------------
# The limits themselves
#
# `01-ARCHITECTURE.md` §11 names upload, follow, comment and message.
# Follow-spam is the first abuse you will see, so that one is the tightest.
# ---------------------------------------------------------------------------

LIMITS: Final[dict[str, Bucket]] = {
    # 20 uploads back to back, then one every 12 seconds. Generous enough for
    # a carousel of ten, tight enough that a script is not a free file host.
    "upload": Bucket(capacity=20, refill_per_second=1 / 12),
    # 30 follows in a burst, then one every 6 seconds — 600/hour sustained.
    # Enough for someone genuinely working through a suggestions list, far
    # short of what a follow-spam bot wants.
    "follow": Bucket(capacity=30, refill_per_second=1 / 6),
    # 15 comments in a burst, then one every 10 seconds.
    "comment": Bucket(capacity=15, refill_per_second=1 / 10),
    # Messaging arrives in Phase 6; the limit is here so it is not forgotten.
    "message": Bucket(capacity=60, refill_per_second=1.0),
    # Reporting is deliberately loose. Someone reporting a lot of content is
    # more likely to be having a bad day than attacking us, and a report costs
    # us one row.
    "report": Bucket(capacity=30, refill_per_second=1 / 4),
    # Placing a call. The tightest limit here, and the only one whose cost is
    # paid by somebody else: a call makes another person's device ring, so an
    # unlimited endpoint is a way to harass someone without ever sending them
    # a word. Five back to back covers a bad line and redialling; one every
    # thirty seconds after that is far below what ring-spam needs.
    #
    # It is also the most expensive request in the product — a LiveKit token,
    # TURN credentials and a fanout publish, none of which are cached.
    "call": Bucket(capacity=5, refill_per_second=1 / 30),
    # Asking for a password reset. Also paid for by somebody else — every
    # request sends mail to an address the requester merely typed — so three
    # back to back and one a minute after that. Enough for someone whose mail
    # is slow to arrive, far too little to use this endpoint as a way to
    # bombard an inbox.
    "password_reset": Bucket(capacity=3, refill_per_second=1 / 60),
}
