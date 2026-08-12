"""The cached half of a counter move.

`increment` is durable and runs on the queue; `apply_now` is what makes the
number in a response the number the client should render. The cases worth
pinning are the two that produced the bug it exists for: a cold key, and a
worker that has not run.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from django.core.cache import cache

from counters import services
from counters.models import Counter
from counters.selectors import cache_key, get_many, get_one

pytestmark = pytest.mark.django_db

ENTITY = Counter.EntityType.POST
METRIC = Counter.Metric.LIKES
ENTITY_ID = 4242


@pytest.fixture(autouse=True)
def _clean_cache() -> Iterator[None]:
    """Counter keys live outside the transaction pytest rolls back."""
    cache.delete(cache_key(ENTITY, ENTITY_ID, METRIC))
    yield
    cache.delete(cache_key(ENTITY, ENTITY_ID, METRIC))


def row(value: int) -> Counter:
    return Counter.objects.create(
        entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, value=value
    )


class TestColdKey:
    def test_seeds_from_the_table_rather_than_starting_at_the_delta(self) -> None:
        """The bug this is for: a post with 43 likes reading "1" after a like."""
        row(43)
        services.apply_now(
            entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
        )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 44

    def test_a_counter_that_has_never_existed_starts_at_the_delta(self) -> None:
        services.apply_now(
            entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
        )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 1


class TestWarmKey:
    def test_moves_the_cached_number_without_touching_the_table(self) -> None:
        """No worker has run. The read must still show the new number."""
        counter = row(10)
        # Warm the key the way a page render would.
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 10

        services.apply_now(
            entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
        )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 11

        counter.refresh_from_db()
        assert counter.value == 10, "the durable write belongs to the queue"

    def test_add_then_remove_returns_to_where_it_started(self) -> None:
        """Like, unlike, like, unlike. The reported symptom was drift here."""
        row(7)
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 7

        for delta in (1, -1, 1, -1):
            services.apply_now(
                entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=delta
            )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 7

    def test_two_moves_in_a_row_both_land(self) -> None:
        """Relative, not absolute — the race `increment` deletes the key to avoid."""
        row(0)
        for _ in range(3):
            services.apply_now(
                entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
            )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 3


class TestAgreementWithTheDurablePath:
    def test_the_worker_landing_afterwards_does_not_double_count(self) -> None:
        """`increment` deletes the key, so the next read comes from the table."""
        row(5)
        services.apply_now(
            entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
        )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 6

        # The queue catches up with the same delta.
        services.increment(
            entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
        )
        assert get_one(entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC) == 6

    def test_batched_reads_see_it_too(self) -> None:
        """`get_many` is what the feed uses; a fix only `get_one` sees is no fix."""
        row(2)
        services.apply_now(
            entity_type=ENTITY, entity_id=ENTITY_ID, metric=METRIC, delta=1
        )
        counts = get_many(entity_type=ENTITY, entity_ids=[ENTITY_ID], metric=METRIC)
        assert counts[ENTITY_ID] == 3
