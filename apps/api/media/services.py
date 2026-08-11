"""Writes for the media app.

Business transactions live here, and this is the only place `.save()` is
called. Anything published to Redis is published *after* the transaction
commits, never inside it -- see `01-ARCHITECTURE.md` §8.

The upload dance, from `01-ARCHITECTURE.md` §6:

    1. POST /api/media/intent  -> row in `pending`, plus a presigned PUT
    2. browser PUTs directly to MinIO / R2
    3. POST /api/media/:id/complete -> Celery task
    4. worker validates, derives, flips to `ready`
    5. client polls (Phase 3) or gets a socket event (Phase 6)

Bytes never pass through this process at any step.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings
from django.db import transaction

from core.media import UploadRejectedError, object_key, validate_intent
from media import storage
from media.models import Media
from users.models import User


@dataclass(frozen=True, slots=True)
class Intent:
    """What the client needs in order to upload."""

    media: Media
    upload_url: str
    expires_in_seconds: int


def create_intent(*, owner: User, kind: str, mime: str, size_bytes: int) -> Intent:
    """Reserve a media row and hand back a URL the browser may PUT to.

    The row exists *before* its bytes do, in `pending`. That is deliberate:
    the id has to exist for the object key to be derivable, and a row with no
    object is a cheap thing to reap later.

    Raises `UploadRejectedError` if the request fails the rules in `core.media` —
    before any storage is handed out, so a bad request costs nothing.
    """
    checked = validate_intent(kind=kind, mime=mime, size_bytes=size_bytes)

    media = Media(
        owner=owner,
        kind=checked.kind,
        declared_mime=checked.mime,
        declared_size_bytes=checked.size_bytes,
        bucket=settings.AWS_STORAGE_BUCKET_NAME,
        state=Media.State.PENDING,
    )
    # The key needs the id, and the id is a snowflake the application already
    # owns — no round trip, no second UPDATE.
    media.object_key = object_key(media.pk, checked.mime)
    media.save()

    url = storage.presigned_put(
        bucket=media.bucket,
        key=media.object_key,
        content_type=checked.mime,
        content_length=checked.size_bytes,
    )

    return Intent(
        media=media,
        upload_url=url,
        expires_in_seconds=settings.S3_PRESIGNED_PUT_EXPIRY_SECONDS,
    )


def mark_uploaded(*, media: Media) -> Media:
    """The browser says the PUT finished. Hand the row to the worker.

    Idempotent: a client that retries `complete` on an already-processed row
    gets the row back rather than a second task. Nothing here trusts the
    client's word that the object exists — the worker checks.

    The task is enqueued **after** the transaction commits. A task that starts
    before the row is visible reads a row that is not there, which is the same
    class of bug as publishing a socket event inside a transaction.
    """
    if media.state != Media.State.PENDING:
        return media

    from media.tasks import process_media

    media_id = media.pk
    transaction.on_commit(lambda: process_media.delay(media_id))
    return media


def mark_ready(
    *,
    media: Media,
    width: int | None,
    height: int | None,
    duration_ms: int | None,
    blurhash: str,
    dominant_color: str,
) -> Media:
    """Everything worked. This is the transition the client is polling for."""
    media.width = width
    media.height = height
    media.duration_ms = duration_ms
    media.blurhash = blurhash
    media.dominant_color = dominant_color
    media.failure_reason = ""
    media.state = Media.State.READY
    media.save(
        update_fields=[
            "width",
            "height",
            "duration_ms",
            "blurhash",
            "dominant_color",
            "failure_reason",
            "state",
            "updated_at",
        ]
    )
    return media


def mark_failed(*, media: Media, reason: str) -> Media:
    """Something was wrong with the file. The reason is shown to the user.

    Only ever given messages from `UploadRejectedError`, which are written for a
    person. An internal error gets a generic reason and a log line instead —
    a stack trace is not a user-facing string.
    """
    media.state = Media.State.FAILED
    media.failure_reason = reason[:255]
    media.save(update_fields=["state", "failure_reason", "updated_at"])
    return media


def set_alt_text(*, media: Media, alt_text: str) -> Media:
    """Alt text is editable after the fact, and may legitimately be empty."""
    media.alt_text = alt_text
    media.save(update_fields=["alt_text", "updated_at"])
    return media


def soft_delete(*, media: Media) -> Media:
    """Soft delete everywhere, plus a scheduled hard delete. See §11."""
    from django.utils import timezone

    media.deleted_at = timezone.now()
    media.save(update_fields=["deleted_at", "updated_at"])
    return media


__all__ = [
    "Intent",
    "UploadRejectedError",
    "create_intent",
    "mark_failed",
    "mark_ready",
    "mark_uploaded",
    "set_alt_text",
    "soft_delete",
]
