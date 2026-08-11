"""Tests for `media.services`."""

from __future__ import annotations

from typing import Any

import pytest

from core.media import UploadRejectedError, object_key
from media import services
from media.models import Media
from users.models import User

pytestmark = pytest.mark.django_db


def test_intent_creates_a_pending_row_before_any_bytes_exist(
    user: User, fake_storage: dict[str, Any]
) -> None:
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1_000_000
    )

    assert intent.media.state == Media.State.PENDING
    assert intent.media.owner_id == user.pk
    assert intent.upload_url.startswith("https://storage.test/")
    assert intent.expires_in_seconds == 300


def test_the_object_key_is_derived_from_the_id(
    user: User, fake_storage: dict[str, Any]
) -> None:
    """No second UPDATE: the application already owns the id."""
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1_000
    )
    assert intent.media.object_key == object_key(intent.media.pk, "image/jpeg")


def test_intent_normalises_the_mime_the_client_sent(
    user: User, fake_storage: dict[str, Any]
) -> None:
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpg", size_bytes=1_000
    )
    assert intent.media.declared_mime == "image/jpeg"


def test_intent_refuses_before_handing_out_storage(
    user: User, fake_storage: dict[str, Any]
) -> None:
    """A rejected request must not leave a row behind."""
    with pytest.raises(UploadRejectedError):
        services.create_intent(
            owner=user, kind="image", mime="application/pdf", size_bytes=1_000
        )
    assert Media.objects.count() == 0


def test_mark_uploaded_is_idempotent(user: User, fake_storage: dict[str, Any]) -> None:
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1_000
    )
    media = intent.media
    services.mark_ready(
        media=media,
        width=10,
        height=10,
        duration_ms=None,
        blurhash="x",
        dominant_color="#000000",
    )

    # Already processed: a retried `complete` must not restart anything.
    again = services.mark_uploaded(media=media)
    assert again.state == Media.State.READY


def test_mark_failed_truncates_to_the_column(
    user: User, fake_storage: dict[str, Any]
) -> None:
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1_000
    )
    services.mark_failed(media=intent.media, reason="x" * 400)
    intent.media.refresh_from_db()
    assert len(intent.media.failure_reason) == 255


def test_soft_delete_leaves_the_row(user: User, fake_storage: dict[str, Any]) -> None:
    """Soft delete everywhere, plus a scheduled hard delete. See §11."""
    intent = services.create_intent(
        owner=user, kind="image", mime="image/jpeg", size_bytes=1_000
    )
    services.soft_delete(media=intent.media)
    assert Media.objects.filter(pk=intent.media.pk).exists()
    assert intent.media.deleted_at is not None
