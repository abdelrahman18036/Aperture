"""Tests for `core.ratelimit`.

No Redis, no clock — every input is a parameter, so the boundary cases that
matter can be stated exactly rather than slept for.
"""

from __future__ import annotations

import pytest

from core.ratelimit import LIMITS, Bucket, consume


def _fresh(bucket: Bucket, now: float = 1000.0) -> tuple[float, float]:
    return bucket.capacity, now


class TestBucket:
    def test_rejects_a_nonsensical_shape(self) -> None:
        with pytest.raises(ValueError):
            Bucket(capacity=0, refill_per_second=1)
        with pytest.raises(ValueError):
            Bucket(capacity=5, refill_per_second=0)


class TestConsume:
    def test_a_full_bucket_allows_its_whole_burst(self) -> None:
        bucket = Bucket(capacity=3, refill_per_second=1)
        tokens, at = _fresh(bucket)

        for _ in range(3):
            decision = consume(bucket=bucket, tokens=tokens, last_seen=at, now=at)
            assert decision.allowed
            tokens, at = decision.tokens, decision.at

        # The fourth in the same instant is the one that is refused.
        assert not consume(bucket=bucket, tokens=tokens, last_seen=at, now=at).allowed

    def test_refuses_at_the_threshold_not_after_it(self) -> None:
        bucket = Bucket(capacity=1, refill_per_second=1)
        first = consume(bucket=bucket, tokens=1, last_seen=0, now=0)
        assert first.allowed
        assert first.tokens == 0

        second = consume(bucket=bucket, tokens=first.tokens, last_seen=0, now=0)
        assert not second.allowed

    def test_refills_over_time(self) -> None:
        bucket = Bucket(capacity=5, refill_per_second=1)
        # Emptied at t=0, one token should be back at t=1.
        refused = consume(bucket=bucket, tokens=0, last_seen=0, now=0)
        assert not refused.allowed

        allowed = consume(bucket=bucket, tokens=0, last_seen=0, now=1)
        assert allowed.allowed

    def test_never_refills_past_capacity(self) -> None:
        """A bucket left alone for a day is still worth one burst, not a day's."""
        bucket = Bucket(capacity=5, refill_per_second=1)
        decision = consume(bucket=bucket, tokens=5, last_seen=0, now=86_400)
        assert decision.tokens == 4

    def test_retry_after_says_when_one_token_returns(self) -> None:
        bucket = Bucket(capacity=10, refill_per_second=0.5)  # one per 2s
        decision = consume(bucket=bucket, tokens=0, last_seen=100, now=100)
        assert not decision.allowed
        assert decision.retry_after == pytest.approx(2.0)
        assert decision.retry_after_seconds == 2

    def test_retry_after_never_advises_zero_when_refused(self) -> None:
        """Advising 0 produces a hot retry loop that is still refused."""
        bucket = Bucket(capacity=10, refill_per_second=100)
        decision = consume(bucket=bucket, tokens=0, last_seen=0, now=0)
        assert not decision.allowed
        assert decision.retry_after_seconds >= 1

    def test_a_backwards_clock_cannot_drain_a_bucket(self) -> None:
        """NTP stepping backwards must not become a denial of service."""
        bucket = Bucket(capacity=5, refill_per_second=1)
        decision = consume(bucket=bucket, tokens=3, last_seen=1000, now=900)
        assert decision.allowed
        assert decision.tokens == 2  # refilled by zero, not by -100

    def test_a_refused_request_still_advances_the_state(self) -> None:
        """Otherwise every refusal recomputes from an ever-older timestamp."""
        bucket = Bucket(capacity=2, refill_per_second=1)
        decision = consume(bucket=bucket, tokens=0, last_seen=0, now=0.5)
        assert not decision.allowed
        assert decision.at == 0.5
        assert decision.tokens == pytest.approx(0.5)

    def test_cost_can_exceed_one(self) -> None:
        bucket = Bucket(capacity=10, refill_per_second=1)
        assert consume(bucket=bucket, tokens=10, last_seen=0, now=0, cost=10).allowed
        assert not consume(bucket=bucket, tokens=9, last_seen=0, now=0, cost=10).allowed

    def test_sustained_rate_matches_the_refill(self) -> None:
        """Drain the burst, then confirm the long-run rate is what it says."""
        bucket = Bucket(capacity=5, refill_per_second=2)  # 2/second sustained
        tokens, at = 0.0, 0.0

        allowed = 0
        for step in range(1, 21):  # ten seconds, sampled twice a second
            now = step * 0.5
            decision = consume(bucket=bucket, tokens=tokens, last_seen=at, now=now)
            if decision.allowed:
                allowed += 1
            tokens, at = decision.tokens, decision.at

        # Ten seconds at 2/s is 20 tokens; we only asked 20 times.
        assert allowed == 20


class TestConfiguredLimits:
    def test_every_named_limit_is_sane(self) -> None:
        for name, bucket in LIMITS.items():
            assert bucket.capacity > 0, name
            assert bucket.refill_per_second > 0, name

    def test_the_brief_s_four_are_all_present(self) -> None:
        """§11 names upload, follow, comment and message."""
        assert {"upload", "follow", "comment", "message"} <= set(LIMITS)

    def test_sustained_hourly_rates_are_what_we_intend(self) -> None:
        """Pins the numbers rather than an ordering between them.

        An earlier version of this test asserted that follow was the tightest
        limit, which sounded right and was not true of the configuration — the
        ordering was invented, not decided. What actually matters is that each
        rate is a deliberate choice, so this states them and makes a change
        require an edit here too.
        """
        per_hour = {
            name: round(bucket.refill_per_second * 3600)
            for name, bucket in LIMITS.items()
        }
        assert per_hour == {
            "upload": 300,
            "follow": 600,
            "comment": 360,
            "message": 3600,
            "report": 900,
            "call": 120,
            "password_reset": 60,
        }

    def test_every_burst_is_survivable_by_a_person(self) -> None:
        """A limit a real user hits by accident is a bug, not a defence.

        Stated per limit rather than as one floor. The floor used to be a flat
        fifteen, which was right while every limit throttled something you do
        to your own account — and wrong the moment `call` arrived, where five
        redials is already generous and fifteen would be ring-spam.
        """
        floors = {
            # A carousel of ten, plus room to retry.
            "upload": 15,
            "follow": 15,
            "comment": 15,
            # Typing fast is not abuse.
            "message": 30,
            "report": 15,
            # Nobody dials the same person five times in a row by accident,
            # and this is the one limit whose cost lands on the person being
            # called rather than the caller.
            "call": 5,
            # The lowest floor here, and it should be. Asking twice because
            # the first mail was slow is normal; asking a fourth time in a
            # burst is either a mistake or somebody using our mail server to
            # fill a stranger's inbox.
            "password_reset": 3,
        }
        assert set(floors) == set(LIMITS), "a new limit needs a burst rationale"
        for name, bucket in LIMITS.items():
            assert bucket.capacity >= floors[name], name
