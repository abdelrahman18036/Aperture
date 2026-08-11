"""Reads for the moderation app.

Every query in this app lives here and returns a queryset.

Note what is deliberately **absent**: block filtering. Everywhere else in this
codebase a read path filters blocks, because it is showing user content to
another user. The moderation queue is not that — a moderator must see the
content precisely because someone objected to it, and a reported account
blocking a staff member must not remove itself from the queue.
"""

from __future__ import annotations

from django.db.models import QuerySet

from moderation.models import Report
from users.models import User


def queue() -> QuerySet[Report]:
    """Open reports, newest first."""
    return (
        Report.objects.filter(status=Report.Status.OPEN)
        .select_related("reporter", "subject_owner")
        .order_by("-id")
    )


def open_reports_for(*, subject_type: str, subject_id: int) -> QuerySet[Report]:
    """Every open report about one thing — the "how bad is this" signal."""
    return Report.objects.filter(
        subject_type=subject_type, subject_id=subject_id, status=Report.Status.OPEN
    )


def existing_open_report(
    *, reporter: User, subject_type: str, subject_id: int
) -> Report | None:
    """Whether this person has already reported this thing.

    Reporting twice is not an error worth surfacing — the caller returns the
    original as though it had just been created.
    """
    return Report.objects.filter(
        reporter=reporter,
        subject_type=subject_type,
        subject_id=subject_id,
        status=Report.Status.OPEN,
    ).first()


def pending_escalations() -> QuerySet[Report]:
    """CSAM reports that have not yet been forwarded.

    §11 requires an NCMEC reporting path. This is the query behind it.
    """
    return Report.objects.filter(
        reason=Report.Reason.CSAM, escalated_at__isnull=True
    ).order_by("id")
