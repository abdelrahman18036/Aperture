"""Wiring the bucket into DRF.

A throttle class rather than middleware, so a view declares which limit
applies to it rather than a URL pattern somewhere else deciding.
"""

from __future__ import annotations

from typing import Any

from rest_framework.throttling import BaseThrottle

from moderation.ratelimit import check, identity_for


class ScopedTokenBucket(BaseThrottle):
    """Apply a named bucket from `core.ratelimit.LIMITS`.

    DRF's own `ScopedRateThrottle` is a fixed window and lives in settings;
    this is the token bucket from `core/`, which §11 asks for by name because
    the built-in "is per-view and coarse".

    Usage on a view::

        throttle_classes = [make_throttle("follow")]
    """

    scope: str = ""

    def allow_request(self, request: Any, view: Any) -> bool:
        verdict = check(scope=self.scope, identity=identity_for(request))
        # Stashed for `wait()`, which DRF calls only after a refusal.
        self._retry_after = verdict.retry_after_seconds
        return verdict.allowed

    def wait(self) -> float | None:
        return float(getattr(self, "_retry_after", 0)) or None


def make_throttle(scope: str) -> type[ScopedTokenBucket]:
    """A throttle class bound to one limit.

    Generated rather than written five times, because the only thing that
    differs is the name of the bucket.
    """
    return type(
        f"{scope.title()}Throttle",
        (ScopedTokenBucket,),
        {"scope": scope},
    )


UploadThrottle = make_throttle("upload")
FollowThrottle = make_throttle("follow")
CommentThrottle = make_throttle("comment")
ReportThrottle = make_throttle("report")
MessageThrottle = make_throttle("message")
