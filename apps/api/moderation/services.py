"""Writes for the moderation app.

Business transactions live here, and this is the only place `.save()` is
called.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from moderation import selectors
from moderation.models import Report
from users.models import User

logger = logging.getLogger(__name__)


class ReportRejectedError(Exception):
    """The report cannot be filed. The message is safe to show a user."""


def _resolve_subject(subject_type: str, subject_id: int) -> tuple[Any, User | None]:
    """Fetch the reported object and whoever owns it.

    Imported locally rather than at module scope: `moderation` sits downstream
    of every content app, and importing them at the top would make the
    dependency cycle real rather than notional.
    """
    if subject_type == Report.Subject.POST:
        from posts.models import Post

        post = Post.objects.filter(pk=subject_id).first()
        return post, (post.author if post else None)

    if subject_type == Report.Subject.COMMENT:
        from posts.models import Comment

        comment = Comment.objects.filter(pk=subject_id).first()
        return comment, (comment.author if comment else None)

    if subject_type == Report.Subject.MEDIA:
        from media.models import Media

        media = Media.objects.filter(pk=subject_id).first()
        return media, (media.owner if media else None)

    if subject_type == Report.Subject.MESSAGE:
        from messaging.models import Message

        message = Message.objects.filter(pk=subject_id).first()
        return message, (message.sender if message else None)

    if subject_type == Report.Subject.STORY:
        from stories.models import Story

        story = Story.objects.filter(pk=subject_id).first()
        return story, (story.author if story else None)

    if subject_type == Report.Subject.USER:
        user = User.objects.filter(pk=subject_id).first()
        return user, user

    return None, None


@transaction.atomic
def file_report(
    *,
    reporter: User,
    subject_type: str,
    subject_id: int,
    reason: str,
    note: str = "",
) -> Report:
    """File a report.

    Idempotent per reporter per subject: clicking twice returns the first
    report rather than filling the queue with duplicates.
    """
    subject, owner = _resolve_subject(subject_type, subject_id)
    if subject is None:
        raise ReportRejectedError("There is nothing there to report.")

    if owner is not None and owner.pk == reporter.pk:
        raise ReportRejectedError("You cannot report your own content.")

    existing = selectors.existing_open_report(
        reporter=reporter, subject_type=subject_type, subject_id=subject_id
    )
    if existing is not None:
        return existing

    try:
        report = Report.objects.create(
            reporter=reporter,
            subject_type=subject_type,
            subject_id=subject_id,
            subject_owner=owner,
            reason=reason,
            note=note,
        )
    except IntegrityError:
        # Two clicks racing. The partial unique constraint decided.
        existing = selectors.existing_open_report(
            reporter=reporter, subject_type=subject_type, subject_id=subject_id
        )
        if existing is None:
            raise
        return existing

    if report.is_csam:
        # Escalation runs after commit: a rolled-back report must not produce
        # a legal filing. Same rule as publishing to Redis — §8.
        from moderation.tasks import escalate_csam_report

        report_id = report.pk
        transaction.on_commit(lambda: escalate_csam_report.delay(report_id))

    return report


@transaction.atomic
def resolve(*, report: Report, moderator: User, action: str, note: str = "") -> Report:
    """Close a report, optionally removing what it was about.

    `action` is one of:

    - `dismiss`  — nothing was wrong.
    - `remove`   — soft-delete the reported content.
    - `suspend`  — soft-delete the content *and* deactivate the account.

    Everything is a soft delete. §11 requires it, and a moderator acting on a
    false report needs the content back.
    """
    if report.status != Report.Status.OPEN:
        return report

    if action == "dismiss":
        report.status = Report.Status.DISMISSED
    elif action in {"remove", "suspend"}:
        _remove_subject(report)
        if action == "suspend" and report.subject_owner is not None:
            suspend(user=report.subject_owner)
        report.status = Report.Status.ACTIONED
    else:
        raise ReportRejectedError(f"Unknown action: {action}")

    report.resolved_by = moderator
    report.resolved_at = timezone.now()
    report.resolution_note = note[:1000]
    report.save(
        update_fields=["status", "resolved_by", "resolved_at", "resolution_note"]
    )

    # Everyone else who reported the same thing gets the same outcome, so the
    # queue does not hand a moderator the same decision ten times.
    (
        selectors.open_reports_for(
            subject_type=report.subject_type, subject_id=report.subject_id
        )
        .exclude(pk=report.pk)
        .update(
            status=report.status,
            resolved_by=moderator,
            resolved_at=report.resolved_at,
            resolution_note="Resolved with an earlier report of the same content.",
        )
    )

    return report


def _remove_subject(report: Report) -> None:
    """Soft-delete whatever was reported."""
    subject, _ = _resolve_subject(report.subject_type, report.subject_id)
    if subject is None:
        return

    if report.subject_type == Report.Subject.POST:
        from posts.services import soft_delete_post

        soft_delete_post(post=subject)
    elif report.subject_type == Report.Subject.COMMENT:
        from posts.services import soft_delete_comment

        soft_delete_comment(comment=subject)
    elif report.subject_type == Report.Subject.MEDIA:
        from media.services import soft_delete

        soft_delete(media=subject)
    elif report.subject_type == Report.Subject.MESSAGE:
        # Removed by the moderator, so the sender check in
        # `soft_delete_message` does not apply — that check exists to stop one
        # person deleting another's message, which is exactly what a
        # moderator is for. Same soft delete, same socket event, so the
        # message disappears from both open threads.
        from messaging.services import remove_message

        remove_message(message=subject)
    elif report.subject_type == Report.Subject.STORY:
        from stories.services import remove_story

        remove_story(story=subject)
    elif report.subject_type == Report.Subject.USER:
        suspend(user=subject)


def suspend(*, user: User) -> None:
    """Deactivate an account without deleting it.

    `is_active=False` rather than `deleted_at`: a suspension is a decision we
    took and may reverse, while `deleted_at` means the person asked to leave
    and starts a clock toward permanent erasure. Conflating them loses that
    distinction exactly when it matters.
    """
    if not user.is_active:
        return
    user.is_active = False
    user.save(update_fields=["is_active"])


def mark_escalated(*, report: Report) -> Report:
    report.escalated_at = timezone.now()
    report.save(update_fields=["escalated_at"])
    return report
