"""Fixtures shared by every app's tests.

`core/` deliberately has none of this — those tests touch no database and
should keep running in milliseconds.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from rest_framework.test import APIClient

from users.models import User


@pytest.fixture
def api() -> APIClient:
    return APIClient()


@pytest.fixture
def user(db: object) -> User:
    return User.objects.create_user(
        email="marko@example.com", username="marko", password="correct-horse-staple"
    )


@pytest.fixture
def other_user(db: object) -> User:
    return User.objects.create_user(
        email="ada@example.com", username="ada", password="correct-horse-staple"
    )


@pytest.fixture
def signed_in(api: APIClient, user: User) -> APIClient:
    api.force_authenticate(user=user)
    return api


@pytest.fixture
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace object storage with a dict.

    The tests that use this are about our own logic — that an intent creates
    a row, that ownership is enforced, that `complete` is idempotent. None of
    that is about whether boto3 can talk to MinIO, and a unit test that needs
    a running MinIO is not a unit test.
    """
    objects: dict[str, bytes] = {}

    def presigned_put(
        *, bucket: str, key: str, content_type: str, content_length: int
    ) -> str:
        return f"https://storage.test/{bucket}/{key}?signed=1"

    def upload(*, bucket: str, key: str, data: bytes, content_type: str) -> None:
        objects[f"{bucket}/{key}"] = data

    def download(*, bucket: str, key: str) -> bytes:
        return objects[f"{bucket}/{key}"]

    def head(*, bucket: str, key: str) -> int | None:
        blob = objects.get(f"{bucket}/{key}")
        return None if blob is None else len(blob)

    from media import storage

    monkeypatch.setattr(storage, "presigned_put", presigned_put)
    monkeypatch.setattr(storage, "upload", upload)
    monkeypatch.setattr(storage, "download", download)
    monkeypatch.setattr(storage, "head", head)

    return {"objects": objects}


@pytest.fixture(autouse=True)
def _no_real_tasks(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Never reach a broker from a test. Enqueues become no-ops.

    Tests that care about what the task does call it directly.
    """
    from media import tasks

    monkeypatch.setattr(tasks.process_media, "delay", lambda *a, **k: None)
    yield


@pytest.fixture(autouse=True)
def _fresh_rate_limits() -> Iterator[None]:
    """Start every test with empty buckets.

    Rate-limit state lives in Redis, outside the transaction pytest-django
    rolls back, so without this it leaks from one test into the next. It only
    became visible with the reset limit — three requests, where the other
    buckets hold thirty — but it was always there, and the shape of the bug is
    a test that passes alone and 429s in a full run.

    Fails open the same way the limiter does: no Redis means no state to
    clear, and a test suite that cannot run without it would be worse than one
    that occasionally shares a bucket.
    """
    import redis as redis_lib

    from moderation.ratelimit import _client

    def clear() -> None:
        try:
            client = _client()
            keys = list(client.scan_iter("ratelimit:*"))
            if keys:
                client.delete(*keys)
        except redis_lib.RedisError:
            pass

    clear()
    yield
