"""Uploaded images and video.

A row here exists *before* its bytes do. The intent endpoint creates it in
`pending`, the browser PUTs directly to object storage against a presigned
URL, and the Celery worker flips it to `ready` once it has validated the real
file and produced derivatives. Bytes never pass through this server — see
`01-ARCHITECTURE.md` §6.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.ids import snowflake


class Media(models.Model):
    """One uploaded asset and everything the UI needs to render it well."""

    class Kind(models.TextChoices):
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    class State(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    owner = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="media"
    )

    kind = models.CharField(max_length=10, choices=Kind.choices)
    bucket = models.CharField(max_length=63)
    object_key = models.CharField(max_length=1024)

    #: What the client *claimed* at intent time. The worker validates the
    #: actual file with ffprobe / python-magic and rejects a mismatch — a
    #: declared image/jpeg that is really something else is the first upload
    #: attack you will see.
    declared_mime = models.CharField(max_length=127)
    declared_size_bytes = models.BigIntegerField()

    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)

    #: Rendered as a canvas before the real image arrives, which is what makes
    #: the develop-in possible and what stops the feed shifting on load.
    blurhash = models.CharField(max_length=64, blank=True)
    #: Feeds the ambient glow behind the photograph — a blurred radial at 8%.
    #: See `02-DESIGN-SYSTEM.md`.
    dominant_color = models.CharField(max_length=32, blank=True)

    alt_text = models.CharField(
        max_length=1000,
        blank=True,
        help_text="May be empty, but the composer always presents the field.",
    )

    state = models.CharField(
        max_length=10, choices=State.choices, default=State.PENDING
    )
    failure_reason = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        db_table = "media"
        verbose_name_plural = "media"
        constraints = [
            models.UniqueConstraint(
                fields=["bucket", "object_key"], name="media_unique_object"
            ),
        ]
        indexes = [
            models.Index(fields=["owner", "-id"], name="media_owner_id_desc_idx"),
            # The worker's work queue, and the sweep that reaps abandoned
            # intents whose bytes never arrived.
            models.Index(
                fields=["state", "created_at"], name="media_state_created_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.id} ({self.state})"

    @property
    def is_ready(self) -> bool:
        return self.state == self.State.READY

    @property
    def aspect_ratio(self) -> float | None:
        """Width over height, or None until the worker has measured it."""
        if not self.width or not self.height:
            return None
        return self.width / self.height
