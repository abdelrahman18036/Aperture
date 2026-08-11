"""The Redis half of rate limiting: state, and where to keep it.

All of the policy is in `core.ratelimit`, which knows nothing about Redis. This
module holds the state and the concurrency, and makes no decisions.

`01-ARCHITECTURE.md` §11 puts rate limits in this app alongside reports,
because they are the same concern: what stops abuse before a moderator has to
look at it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import redis
from django.conf import settings
from rest_framework.request import Request

from core.ratelimit import LIMITS, Decision, consume

#: How long an idle bucket's state is worth keeping. Once a bucket has had
#: time to refill completely, its stored state is indistinguishable from a
#: fresh one, so expiring it costs nothing and stops Redis growing forever.
IDLE_GRACE_SECONDS = 60

#: Optimistic-locking retries before giving up and allowing the request.
#: Contention on a single user's bucket is rare; failing open after this many
#: attempts is better than failing closed on a hot key.
MAX_ATTEMPTS = 3


@dataclass(frozen=True, slots=True)
class Verdict:
    allowed: bool
    retry_after_seconds: int
    scope: str


def _client() -> redis.Redis:
    return redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def _key(scope: str, identity: str) -> str:
    return f"ratelimit:{scope}:{identity}"


def check(*, scope: str, identity: str, cost: float = 1.0) -> Verdict:
    """Spend a token, or refuse.

    Atomic through `WATCH`/`MULTI` rather than a Lua script, deliberately: a
    script would mean writing the token-bucket arithmetic a second time, in a
    second language, where it could drift from the tested one. The optimistic
    loop keeps `core.ratelimit` the only implementation.

    Fails **open**. A rate limiter that takes the site down when Redis hiccups
    has caused more damage than the abuse it was preventing.
    """
    bucket = LIMITS.get(scope)
    if bucket is None:
        raise KeyError(f"unknown rate-limit scope: {scope}")

    key = _key(scope, identity)

    try:
        client = _client()
        with client.pipeline() as pipe:
            for _ in range(MAX_ATTEMPTS):
                try:
                    pipe.watch(key)  # type: ignore[no-untyped-call]
                    stored = pipe.hgetall(key)
                    now = time.time()

                    tokens = float(stored.get("tokens", bucket.capacity))
                    last_seen = float(stored.get("at", now))

                    decision: Decision = consume(
                        bucket=bucket,
                        tokens=tokens,
                        last_seen=last_seen,
                        now=now,
                        cost=cost,
                    )

                    pipe.multi()
                    pipe.hset(
                        key,
                        mapping={"tokens": decision.tokens, "at": decision.at},
                    )
                    pipe.expire(key, int(bucket.seconds_to_full) + IDLE_GRACE_SECONDS)
                    pipe.execute()

                    return Verdict(
                        allowed=decision.allowed,
                        retry_after_seconds=decision.retry_after_seconds,
                        scope=scope,
                    )
                except redis.WatchError:
                    continue
                finally:
                    pipe.reset()
    except redis.RedisError:
        return Verdict(allowed=True, retry_after_seconds=0, scope=scope)

    # Lost the race MAX_ATTEMPTS times. Allow rather than refuse.
    return Verdict(allowed=True, retry_after_seconds=0, scope=scope)


def identity_for(request: Request) -> str:
    """Who to charge.

    Per-user when signed in, per-IP otherwise, per `01-ARCHITECTURE.md` §11's
    "per-user and per-IP". An authenticated identity is the meaningful one:
    IPs are shared by whole offices and countries, and rotating them is cheap.
    """
    user = request.user
    if user.is_authenticated:
        return f"user:{user.pk}"
    return f"ip:{client_ip(request)}"


def client_ip(request: Request) -> str:
    """The client's address, trusting the proxy header only if configured.

    `X-Forwarded-For` is client-controlled unless something upstream is known
    to overwrite it. Trusting it by default lets anyone reset their own limit
    by sending a header, which is worse than having no limit at all — it looks
    like protection.
    """
    if settings.TRUST_X_FORWARDED_FOR:
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return str(forwarded).split(",")[0].strip()
    return str(request.META.get("REMOTE_ADDR", "unknown"))
