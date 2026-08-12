"""Denormalised counts.

Rule 9 is absolute: **no `.count()` and no `COUNT(*)` on a request path.** A
follower count on a popular account is a sequential scan over millions of
rows, and it renders on every profile view. This table plus a Redis cache is
the answer, and Celery keeps it current.

Deliberately generic — `(entity_type, entity_id, metric)` — because the same
mechanism serves follower counts, post counts, like counts and unread counts,
and one shape means one place to get the invalidation right.
"""

from __future__ import annotations

from django.db import models

from core.ids import snowflake


class Counter(models.Model):
    """One metric for one entity."""

    class EntityType(models.TextChoices):
        USER = "user", "User"
        POST = "post", "Post"
        COMMENT = "comment", "Comment"
        CONVERSATION = "conversation", "Conversation"

    class Metric(models.TextChoices):
        FOLLOWERS = "followers", "Followers"
        FOLLOWING = "following", "Following"
        POSTS = "posts", "Posts"
        LIKES = "likes", "Likes"
        COMMENTS = "comments", "Comments"
        REPLIES = "replies", "Replies"
        REPOSTS = "reposts", "Reposts"
        SHARES = "shares", "Shares"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)
    entity_type = models.CharField(max_length=20, choices=EntityType.choices)
    entity_id = models.BigIntegerField()
    metric = models.CharField(max_length=20, choices=Metric.choices)
    value = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "counters"
        constraints = [
            models.UniqueConstraint(
                fields=["entity_type", "entity_id", "metric"],
                name="counters_unique_metric",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.entity_type}:{self.entity_id} {self.metric}={self.value}"
