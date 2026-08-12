"""Reports, and the record of what a moderator did about them.

`01-ARCHITECTURE.md` §11 is blunt about why this exists on day one: public
image upload attracts CSAM, spam and copyright claims within days of traction,
and that is a legal and ethical obligation from the first public user rather
than a Phase 9 feature. **The report button ships before stories.**

The queue is deliberately generic over what is being reported — a post, a
comment, a user or a piece of media — because a moderator's workflow is the
same shape for all four and a table per kind would mean four consoles.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.ids import snowflake


class Report(models.Model):
    """Someone told us about something."""

    class Subject(models.TextChoices):
        POST = "post", "Post"
        COMMENT = "comment", "Comment"
        USER = "user", "User"
        MEDIA = "media", "Media"
        #: A direct message. Reportable for the same reason a comment is —
        #: harassment more often arrives in a thread nobody else can see than
        #: under a photograph where it is public. A queue that covers only
        #: public content covers the easy half.
        MESSAGE = "message", "Message"

    class Reason(models.TextChoices):
        #: First, and not alphabetically. It routes differently from
        #: everything else below it and must never be buried in a dropdown.
        CSAM = "csam", "Child sexual abuse material"
        VIOLENCE = "violence", "Violence or threats"
        HARASSMENT = "harassment", "Harassment or bullying"
        HATE = "hate", "Hate speech"
        NUDITY = "nudity", "Adult nudity or sexual activity"
        SPAM = "spam", "Spam or scam"
        SELF_HARM = "self_harm", "Self-harm or suicide"
        COPYRIGHT = "copyright", "Copyright or trademark"
        OTHER = "other", "Something else"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ACTIONED = "actioned", "Actioned"
        DISMISSED = "dismissed", "Dismissed"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)

    reporter = models.ForeignKey(
        "users.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_made",
        help_text="Null once the reporting account is deleted.",
    )

    subject_type = models.CharField(max_length=10, choices=Subject.choices)
    subject_id = models.BigIntegerField()
    #: Denormalised so the queue can be filtered and actioned without joining
    #: four different tables to find out whose content this was.
    subject_owner = models.ForeignKey(
        "users.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_against",
    )

    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.TextField(max_length=1000, blank=True)

    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.OPEN
    )
    resolution_note = models.TextField(max_length=1000, blank=True)
    resolved_by = models.ForeignKey(
        "users.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reports_resolved",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    #: Set when a CSAM report has been forwarded. Kept as a timestamp rather
    #: than a boolean because "when" is the question that gets asked.
    escalated_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        db_table = "reports"
        constraints = [
            # One open report per person per thing. Without this, a brigade
            # of a hundred people produces a hundred queue items for one post
            # and buries everything else.
            models.UniqueConstraint(
                fields=["reporter", "subject_type", "subject_id"],
                condition=models.Q(status="open"),
                name="reports_one_open_per_reporter",
            ),
        ]
        indexes = [
            # The queue itself: open reports, worst first, newest first.
            models.Index(
                fields=["status", "-id"],
                name="reports_status_id_desc_idx",
            ),
            models.Index(
                fields=["subject_type", "subject_id"],
                name="reports_subject_idx",
            ),
            models.Index(fields=["subject_owner"], name="reports_owner_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.reason} on {self.subject_type}:{self.subject_id}"

    @property
    def is_csam(self) -> bool:
        """The one reason with a legal reporting obligation attached."""
        return self.reason == self.Reason.CSAM
