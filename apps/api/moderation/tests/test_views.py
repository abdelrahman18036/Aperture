"""Tests for the report endpoint and the rate limiter over HTTP.

The rate-limit tests talk to real Redis, because the thing being tested is the
optimistic-locking adapter rather than the arithmetic — `core.ratelimit` has
that covered without any I/O at all.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from rest_framework.test import APIClient

from core.ratelimit import LIMITS
from moderation import ratelimit
from moderation.models import Report
from posts.models import Post
from users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def scope_identity() -> str:
    """A fresh identity per test, so buckets never leak between them."""
    return f"test:{uuid.uuid4()}"


class TestReportEndpoint:
    def test_requires_authentication(self, api: APIClient) -> None:
        assert api.post("/api/moderation/reports", {}, format="json").status_code == 403

    def test_files_a_report(self, signed_in: APIClient, other_user: User) -> None:
        post = Post.objects.create(author=other_user)
        response = signed_in.post(
            "/api/moderation/reports",
            {
                "subject_type": "post",
                "subject_id": str(post.pk),
                "reason": "spam",
                "note": "selling watches",
            },
            format="json",
        )
        assert response.status_code == 201
        assert Report.objects.count() == 1

    def test_the_reporter_is_told_nothing_about_the_outcome(
        self, signed_in: APIClient, other_user: User
    ) -> None:
        """Telling them leaks a third party's moderation state."""
        post = Post.objects.create(author=other_user)
        response = signed_in.post(
            "/api/moderation/reports",
            {"subject_type": "post", "subject_id": str(post.pk), "reason": "spam"},
            format="json",
        )
        body = response.json()
        assert "status" not in body
        assert "resolution_note" not in body
        assert "subject_owner" not in body


class TestRateLimiting:
    def test_allows_the_burst_then_refuses(self, scope_identity: str) -> None:
        bucket = LIMITS["report"]

        allowed = 0
        for _ in range(bucket.capacity):
            if ratelimit.check(scope="report", identity=scope_identity).allowed:
                allowed += 1

        assert allowed == bucket.capacity

        # The one past the threshold is the one that is refused.
        verdict = ratelimit.check(scope="report", identity=scope_identity)
        assert not verdict.allowed
        assert verdict.retry_after_seconds >= 1

    def test_identities_have_separate_buckets(self, scope_identity: str) -> None:
        bucket = LIMITS["report"]
        for _ in range(bucket.capacity + 1):
            ratelimit.check(scope="report", identity=scope_identity)

        other = ratelimit.check(scope="report", identity=f"{scope_identity}-other")
        assert other.allowed

    def test_an_unknown_scope_is_a_programming_error(self, scope_identity: str) -> None:
        with pytest.raises(KeyError):
            ratelimit.check(scope="not-a-limit", identity=scope_identity)

    def test_fails_open_when_redis_is_unreachable(
        self, monkeypatch: pytest.MonkeyPatch, scope_identity: str
    ) -> None:
        """A limiter that takes the site down has done more harm than the abuse."""
        import redis

        def explode(*args: Any, **kwargs: Any) -> Any:
            raise redis.ConnectionError("nope")

        monkeypatch.setattr(ratelimit, "_client", explode)
        assert ratelimit.check(scope="report", identity=scope_identity).allowed

    def test_the_endpoint_returns_429_at_the_threshold(
        self, signed_in: APIClient, other_user: User
    ) -> None:
        post = Post.objects.create(author=other_user)
        payload = {
            "subject_type": "post",
            "subject_id": str(post.pk),
            "reason": "spam",
        }

        statuses = [
            signed_in.post(
                "/api/moderation/reports", payload, format="json"
            ).status_code
            for _ in range(LIMITS["report"].capacity + 2)
        ]

        assert 429 in statuses
        # Everything before the first 429 was accepted.
        assert statuses.index(429) >= LIMITS["report"].capacity

    def test_a_429_carries_retry_after(
        self, signed_in: APIClient, other_user: User
    ) -> None:
        post = Post.objects.create(author=other_user)
        payload = {
            "subject_type": "post",
            "subject_id": str(post.pk),
            "reason": "spam",
        }

        response = None
        for _ in range(LIMITS["report"].capacity + 2):
            response = signed_in.post("/api/moderation/reports", payload, format="json")
            if response.status_code == 429:
                break

        assert response is not None
        assert response.status_code == 429
        assert "Retry-After" in response.headers


class TestClientIdentity:
    def test_x_forwarded_for_is_ignored_unless_configured(self, settings: Any) -> None:
        """Trusting it by default lets anyone reset their own limit."""
        from rest_framework.test import APIRequestFactory

        settings.TRUST_X_FORWARDED_FOR = False
        request = APIRequestFactory().get(
            "/", HTTP_X_FORWARDED_FOR="1.2.3.4", REMOTE_ADDR="10.0.0.1"
        )
        assert ratelimit.client_ip(request) == "10.0.0.1"

    def test_x_forwarded_for_is_honoured_when_configured(self, settings: Any) -> None:
        from rest_framework.test import APIRequestFactory

        settings.TRUST_X_FORWARDED_FOR = True
        request = APIRequestFactory().get(
            "/", HTTP_X_FORWARDED_FOR="1.2.3.4, 5.6.7.8", REMOTE_ADDR="10.0.0.1"
        )
        assert ratelimit.client_ip(request) == "1.2.3.4"
