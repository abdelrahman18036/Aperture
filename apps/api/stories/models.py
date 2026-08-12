"""Stories — a post that expires.

`01-ARCHITECTURE.md` §11 is explicit that "the report button ships before
stories", and it did: reports, the queue and the console all landed in Phase
5. This is the feature that was waiting on that.

**The expiry is a column, not a job.** `expires_at` is written once at
creation and every read filters on it, so a story is gone from every surface
the instant it lapses whether or not a worker is running. A scheduled task
that flips a flag would mean a window where an expired story is still
visible, and that window is exactly what someone posting to a story is
trusting us not to have.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from django.db import models
from django.utils import timezone

from core.ids import snowflake

#: How long a story lives. The number everyone else uses, and the number
#: people posting to one already expect.
STORY_TTL = timedelta(hours=24)


def default_expiry() -> datetime:
    return timezone.now() + STORY_TTL


class Story(models.Model):
    """One frame of someone's day."""

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    author = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="stories"
    )
    #: `PROTECT` rather than `CASCADE`: media is soft-deleted everywhere else
    #: in this codebase, and a story losing its picture out from under it
    #: would render an empty frame rather than disappear.
    media = models.ForeignKey(
        "media.Media", on_delete=models.PROTECT, related_name="stories"
    )
    caption = models.CharField(max_length=200, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=default_expiry)
    #: Soft, like everything else. §11 requires it, and a story someone
    #: deleted by mistake is recoverable inside the grace period.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "stories"
        indexes = [
            # The tray query: live stories by a set of authors, newest last.
            models.Index(fields=["author", "expires_at"], name="stories_author_expiry"),
            models.Index(fields=["expires_at"], name="stories_expiry"),
        ]
        ordering = ["id"]

    def __str__(self) -> str:
        return f"story {self.pk} by {self.author.pk}"

    @property
    def is_live(self) -> bool:
        return self.deleted_at is None and self.expires_at > timezone.now()


class StoryView(models.Model):
    """Who has seen a story.

    Rows rather than a counter, because this drives two different things: the
    ring on the tray (have *you* seen it) and the viewer list an author sees
    (who has). A counter answers neither.
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="views")
    viewer = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="story_views"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "story_views"
        constraints = [
            # Seeing a story twice is seeing it once. The constraint is what
            # makes `mark_viewed` idempotent without a read first.
            models.UniqueConstraint(
                fields=["story", "viewer"], name="story_views_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.viewer.pk} saw {self.story.pk}"
