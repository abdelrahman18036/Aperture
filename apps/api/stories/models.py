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


#: The backgrounds a text story may use.
#:
#: Deliberately **not** the accent colours. `02-DESIGN-SYSTEM.md` caps the
#: accent at "rings, icon fills, 1px underlines" and rules out anything
#: accent-filled above 40px tall — a full-bleed safelight rectangle is the
#: most literal violation of that available. These are content colours in
#: the sense a photograph is: desaturated, dark enough for `--color-ink` to
#: sit on at 4.5:1, and none of them warm-accent or cool-accent.
STORY_BACKGROUNDS: dict[str, str] = {
    "slate": "linear-gradient(160deg, #1B1E28, #0B0B0E)",
    "moss": "linear-gradient(160deg, #16241C, #0B0F0C)",
    "plum": "linear-gradient(160deg, #241823, #100B10)",
    "clay": "linear-gradient(160deg, #2A1E17, #120C09)",
    "ink": "linear-gradient(160deg, #14141A, #000000)",
}

DEFAULT_BACKGROUND = "slate"


class Story(models.Model):
    """One frame of someone's day — a photograph, a clip, or just words."""

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    author = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="stories"
    )
    #: Null for a text story. `PROTECT` rather than `CASCADE` when it is set:
    #: media is soft-deleted everywhere else in this codebase, and a story
    #: losing its picture out from under it would render an empty frame
    #: rather than disappear.
    media = models.ForeignKey(
        "media.Media",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="stories",
    )
    #: The whole content of a text story, and unused by a media one — where
    #: `caption` is the line under the picture. Two fields rather than one
    #: because they are different things: 200 characters under a photograph
    #: is a caption, and 700 on a coloured ground is the post.
    text = models.TextField(max_length=700, blank=True)
    background = models.CharField(max_length=16, default=DEFAULT_BACKGROUND, blank=True)
    caption = models.CharField(max_length=200, blank=True)
    #: The first link in the text or caption. A cache, so `SET_NULL`.
    link_preview = models.ForeignKey(
        "links.LinkPreview",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stories",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=default_expiry)
    #: Soft, like everything else. §11 requires it, and a story someone
    #: deleted by mistake is recoverable inside the grace period.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "stories"
        constraints = [
            # A story is a picture or it is words. One with neither is an
            # empty frame somebody would have to scroll past, and the check
            # lives here rather than only in the service so no future code
            # path can write one.
            models.CheckConstraint(
                condition=models.Q(media__isnull=False) | ~models.Q(text=""),
                name="stories_have_content",
            ),
        ]
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


class StoryReaction(models.Model):
    """One emoji from one person on one story.

    A row rather than a counter, for the same reason `StoryView` is: the
    author wants to know *who*, and a reaction can be taken back.
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="story_reactions"
    )
    #: Short enough for one emoji including a skin-tone modifier and a ZWJ
    #: sequence, short enough not to be a text field in disguise.
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "story_reactions"
        constraints = [
            # One reaction per person per story; reacting again replaces it.
            models.UniqueConstraint(
                fields=["story", "user"], name="story_reactions_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user.pk} {self.emoji} {self.story.pk}"
