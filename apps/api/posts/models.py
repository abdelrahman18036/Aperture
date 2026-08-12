"""Posts, carousels, likes, comments, and the Phase 8 push timeline.

Soft delete everywhere: `deleted_at` is set, rows stay, and a scheduled job
hard-deletes later. Real account deletion is a GDPR requirement and writing
data archaeology under a deadline is the alternative.
"""

from __future__ import annotations

from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from core.ids import snowflake


class Post(models.Model):
    """A photograph or video, possibly a carousel of them."""

    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public"
        FOLLOWERS = "followers", "Followers only"
        PRIVATE = "private", "Private"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    #: The first link in the caption, if there was one and it was fetchable.
    #: `SET_NULL` rather than `CASCADE`: a preview row is a cache, and losing
    #: one must never take the post with it.
    link_preview = models.ForeignKey(
        "links.LinkPreview",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="posts",
    )
    author = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="posts"
    )
    #: What this is a repost of, if it is one.
    #:
    #: A repost is a `Post` rather than its own model, because it *is* one:
    #: it appears in feeds, carries its own likes and comments, and can be
    #: deleted independently. A separate table would mean every read path
    #: unioning two sources forever. `CASCADE` — a repost of a hard-deleted
    #: post has nothing left to show.
    reposted_from = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="reposts",
    )
    caption = models.TextField(max_length=2200, blank=True)
    location = models.CharField(max_length=120, blank=True)
    visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.PUBLIC
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    deleted_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        db_table = "posts"
        indexes = [
            # The profile contact sheet.
            models.Index(fields=["author", "-id"], name="posts_author_id_desc_idx"),
            # The feed. Partial, because a deleted post is never a feed
            # candidate and there is no reason to carry it in the index.
            models.Index(
                F("id").desc(),
                condition=Q(deleted_at__isnull=True),
                name="posts_live_id_desc_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"post:{self.id} by {self.author_id}"

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class PostMedia(models.Model):
    """Ordered attachment of media to a post — this is what makes carousels."""

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    post = models.ForeignKey(
        "posts.Post", on_delete=models.CASCADE, related_name="attachments"
    )
    media = models.ForeignKey(
        "media.Media", on_delete=models.PROTECT, related_name="post_attachments"
    )
    position = models.SmallIntegerField(default=0)

    class Meta:
        db_table = "post_media"
        verbose_name_plural = "post media"
        constraints = [
            models.UniqueConstraint(
                fields=["post", "position"], name="post_media_unique_position"
            ),
            models.UniqueConstraint(
                fields=["post", "media"], name="post_media_unique_media"
            ),
        ]
        ordering = ["position"]

    def __str__(self) -> str:
        return f"post:{self.post_id}[{self.position}] -> media:{self.media_id}"


class Like(models.Model):
    """A like.

    `01-ARCHITECTURE.md` §5 puts post first in the key on purpose: the hot
    query is "who liked this", not "what did this person like".
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    post = models.ForeignKey(
        "posts.Post", on_delete=models.CASCADE, related_name="likes"
    )
    user = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="likes"
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        db_table = "likes"
        constraints = [
            models.UniqueConstraint(fields=["post", "user"], name="likes_unique"),
        ]
        indexes = [
            models.Index(
                fields=["user", "-created_at"], name="likes_user_created_desc_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} likes post:{self.post_id}"


class Comment(models.Model):
    """A comment, optionally a reply to another comment."""

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    post = models.ForeignKey(
        "posts.Post", on_delete=models.CASCADE, related_name="comments"
    )
    author = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="comments"
    )
    parent = models.ForeignKey(
        "posts.Comment",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    body = models.TextField(max_length=2200)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    deleted_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        db_table = "comments"
        indexes = [
            models.Index(fields=["post", "id"], name="comments_post_id_idx"),
            models.Index(fields=["parent", "id"], name="comments_parent_id_idx"),
        ]

    def __str__(self) -> str:
        return f"comment:{self.id} on post:{self.post_id}"

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class TimelineEntry(models.Model):
    """Materialised feed row for push fanout.

    **Phase 8 only, and only on instrumentation.** Nothing writes here yet.
    The table is modelled now because adding it later is a migration on a live
    system, but the feed is a pull query until p99 says otherwise — see
    `01-ARCHITECTURE.md` §7.
    """

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    user = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="timeline"
    )
    post = models.ForeignKey(
        "posts.Post", on_delete=models.CASCADE, related_name="timeline_entries"
    )
    author = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="timeline_authored"
    )
    score = models.FloatField(default=0.0)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        db_table = "timeline"
        verbose_name_plural = "timeline entries"
        constraints = [
            models.UniqueConstraint(fields=["user", "post"], name="timeline_unique"),
        ]
        indexes = [
            models.Index(
                fields=["user", "-created_at"], name="timeline_user_created_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"timeline[{self.user_id}] post:{self.post_id}"
