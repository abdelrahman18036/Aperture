"""Tests for `core.ids`.

No database, no Django settings, no fixtures — that is the point of `core/`.
These should run in milliseconds.
"""

from __future__ import annotations

import threading

import pytest

from core.ids import (
    EPOCH_MS,
    MAX_NODE_ID,
    MAX_SEQUENCE,
    ClockMovedBackwardsError,
    SnowflakeGenerator,
    decode,
    snowflake,
    timestamp_ms_of,
)


def test_ids_are_positive_and_fit_signed_64_bit() -> None:
    gen = SnowflakeGenerator(node_id=1)
    for _ in range(1_000):
        value = gen.next_id()
        assert 0 < value < 2**63


def test_ids_are_monotonic_within_a_process() -> None:
    gen = SnowflakeGenerator(node_id=1)
    values = [gen.next_id() for _ in range(10_000)]
    assert values == sorted(values)
    assert len(set(values)) == len(values)


def test_ordering_by_id_is_ordering_by_time() -> None:
    """The property the whole schema leans on for cursor pagination."""
    gen = SnowflakeGenerator(node_id=3)
    first = gen.next_id()
    last = gen.next_id()
    assert timestamp_ms_of(first) <= timestamp_ms_of(last)
    assert first < last


def test_decode_round_trips_the_three_fields() -> None:
    gen = SnowflakeGenerator(node_id=42)
    parts = decode(gen.next_id())
    assert parts.node_id == 42
    assert 0 <= parts.sequence <= MAX_SEQUENCE
    # Encoded time should be roughly now, i.e. after the epoch and not absurd.
    assert parts.timestamp_ms > EPOCH_MS


def test_distinct_nodes_never_collide() -> None:
    """Two processes minting in the same millisecond must not agree."""
    generators = [SnowflakeGenerator(node_id=n) for n in range(8)]
    values = [gen.next_id() for gen in generators for _ in range(500)]
    assert len(set(values)) == len(values)


def test_concurrent_threads_never_collide() -> None:
    gen = SnowflakeGenerator(node_id=7)
    collected: list[list[int]] = []
    lock = threading.Lock()

    def worker() -> None:
        mine = [gen.next_id() for _ in range(2_000)]
        with lock:
            collected.append(mine)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    flat = [value for batch in collected for value in batch]
    assert len(set(flat)) == len(flat)


def test_sequence_rollover_advances_the_millisecond() -> None:
    """Burning all 4096 slots in one millisecond must spin, not repeat."""
    gen = SnowflakeGenerator(node_id=1)
    values = [gen.next_id() for _ in range(MAX_SEQUENCE * 3)]
    assert len(set(values)) == len(values)
    assert values == sorted(values)


def test_rejects_out_of_range_node_ids() -> None:
    with pytest.raises(ValueError):
        SnowflakeGenerator(node_id=-1)
    with pytest.raises(ValueError):
        SnowflakeGenerator(node_id=MAX_NODE_ID + 1)


def test_large_backwards_clock_step_raises_rather_than_minting() -> None:
    """An NTP step must not be allowed to reissue IDs that already exist."""
    gen = SnowflakeGenerator(node_id=1)
    gen.next_id()

    # Pretend the last ID we issued was minted a minute into the future.
    gen._last_timestamp_ms += 60_000

    with pytest.raises(ClockMovedBackwardsError):
        gen.next_id()


def test_module_level_snowflake_is_usable_as_a_field_default() -> None:
    first = snowflake()
    second = snowflake()
    assert isinstance(first, int)
    assert second > first
