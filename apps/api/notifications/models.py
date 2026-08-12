"""What happened to you while you were away.

**One row per (recipient, actor, verb, subject).** Ten people liking a post
is ten rows, and the read path groups them into "Ada and 9 others liked your
photograph" — rather than one row with a counter, which cannot answer "who"
and cannot be un-done when somebody unlikes.

Nothing here is generated for yourself. Liking your own post, commenting on
your own photograph and following-back are all real actions and none of them
is news, so `services.notify` drops them before a row exists.

Deleted rather than marked when the cause goes away: an unlike removes the
notification. A tombstone would mean "Ada liked your post" surviving Ada
changing her mind, which is a small lie the product has no reason to tell.
"""

from __future__ import annotations

from django.db import models

from core.ids import snowflake


class Notification(models.Model):
    """One thing somebody did to something of yours."""

    class Verb(models.TextChoices):
        LIKE = "like", "Liked your post"
        COMMENT = "comment", "Commented on your post"
        FOLLOW = "follow", "Started following you"
        FOLLOW_REQUEST = "follow_request", "Asked to follow you"
        REPOST = "repost", "Reposted your post"
        STORY_REACTION = "story_reaction", "Reacted to your story"
        MENTION = "mention", "Mentioned you"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)

    recipient = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="notifications"
    )
    #: Who did it. `CASCADE`: a deleted account's notifications go with it,
    #: which is the same rule every other read path follows for their content.
    actor = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="notifications_caused"
    )
    verb = models.CharField(max_length=20, choices=Verb.choices)

    #: What it was about, when there is one. A follow has no subject.
    #: Deliberately not a `GenericForeignKey`: those cost a join per row and
    #: cannot be `select_related`, which is exactly wrong for a list that is
    #: read constantly and written rarely.
    post = models.ForeignKey(
        "posts.Post",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    comment = models.ForeignKey(
        "posts.Comment",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    story = models.ForeignKey(
        "stories.Story",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )

    #: For a story reaction, the emoji. Empty otherwise.
    detail = models.CharField(max_length=32, blank=True)

    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        constraints = [
            # The same person liking the same post twice is one notification.
            # Without this, unlike-and-relike stacks them up.
            models.UniqueConstraint(
                fields=["recipient", "actor", "verb", "post"],
                condition=models.Q(post__isnull=False, comment__isnull=True),
                name="notifications_unique_post_verb",
            ),
        ]
        indexes = [
            # The list query: newest first for one recipient.
            models.Index(fields=["recipient", "-id"], name="notifications_recipient"),
            # The unread count, which is read on every page load.
            models.Index(fields=["recipient", "read_at"], name="notifications_unread"),
        ]

    def __str__(self) -> str:
        return f"{self.actor.pk} {self.verb} -> {self.recipient.pk}"
