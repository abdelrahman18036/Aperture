"""Celery tasks for the moderation app.

Three jobs live here: forwarding CSAM reports, scanning uploads, and the
scheduled hard delete that turns a soft delete into a real one.

The hard delete is the one `01-ARCHITECTURE.md` §11 warns about: "Real account
deletion is a GDPR requirement. Soft-delete everywhere plus a scheduled
hard-delete task, or you'll write a data-archaeology script under a deadline."
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from django.utils.module_loading import import_string

from moderation import selectors, services
from moderation.models import Report

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

    from media.models import Media

logger = logging.getLogger(__name__)


@shared_task(name="moderation.escalate_csam_report", bind=True, max_retries=5)
def escalate_csam_report(self: Any, report_id: int) -> str:
    """Forward a CSAM report down the NCMEC path.

    **This is a seam, not an integration.** Filing with NCMEC requires a
    registered ESP account and their CyberTipline API, which is not something
    that can be stubbed usefully or tested against. What this task guarantees
    is that every CSAM report reaches exactly one place, exactly once, with a
    retry policy and an audit timestamp — so wiring the real endpoint is a
    change to `_deliver()` and nothing else.

    Until then it logs at CRITICAL and leaves `escalated_at` unset unless
    delivery is configured, so an unforwarded report stays visibly unforwarded
    rather than silently looking handled.
    """
    report = Report.objects.filter(pk=report_id).first()
    if report is None:
        return "missing"
    if report.escalated_at is not None:
        return "already-escalated"

    logger.critical(
        "CSAM report %s on %s:%s owned by %s — escalation required",
        report.pk,
        report.subject_type,
        report.subject_id,
        report.subject_owner_id,
    )

    if not settings.NCMEC_REPORTING_ENABLED:
        # Deliberately does not mark it escalated. A queue of un-escalated
        # CSAM reports is a visible problem; a queue of ones falsely marked
        # done is an invisible one.
        return "logged-only"

    _deliver(report)
    services.mark_escalated(report=report)
    return "escalated"


def _deliver(report: Report) -> None:
    """Hand the report to NCMEC, via whatever `NCMEC_BACKEND` names.

    Resolved per call rather than at import, so a test — or a deployment
    reloading settings — can change it without reimporting this module.
    """
    import_string(settings.NCMEC_BACKEND)(report)


@shared_task(name="moderation.scan_media")
def scan_media(media_id: int) -> str:
    """Hash-match an upload against known CSAM.

    §11 asks for "CSAM scanning on the bucket". In production this is
    PhotoDNA or Cloudflare's CSAM Scanning Tool — both are hash-matching
    services you register for, and neither can be approximated locally.

    The seam is what matters now: the media pipeline calls this for every
    image that reaches `ready`, so turning scanning on is a change to
    `_match()` rather than a change to the pipeline.
    """
    from media.models import Media

    media = Media.objects.filter(pk=media_id).first()
    if media is None or media.kind != Media.Kind.IMAGE:
        return "skipped"

    if not settings.CSAM_SCANNING_ENABLED:
        return "disabled"

    if _match(media):
        services.suspend(user=media.owner)
        Report.objects.create(
            reporter=None,
            subject_type=Report.Subject.MEDIA,
            subject_id=media.pk,
            subject_owner=media.owner,
            reason=Report.Reason.CSAM,
            note="Automated hash match.",
        )
        logger.critical("automated CSAM match on media %s", media.pk)
        return "matched"

    return "clean"


def _match(media: Media) -> bool:
    """Hash-match against a known-CSAM corpus, via `CSAM_HASH_BACKEND`."""
    matched: bool = import_string(settings.CSAM_HASH_BACKEND)(media)
    return matched


@shared_task(name="moderation.hard_delete_expired")
def hard_delete_expired() -> dict[str, int]:
    """Turn soft deletes into real ones, once the grace period has passed.

    Runs on a schedule. `01-ARCHITECTURE.md` §11 requires this to exist from
    day one, because writing it later means writing a data-archaeology script
    under a deadline.

    Order matters: objects in storage go before rows, because a row is how we
    find the object. Losing the row first orphans the file forever.
    """
    from media.models import Media
    from media.storage import client
    from posts.models import Comment, Post
    from users.models import User

    cutoff = timezone.now() - timedelta(days=settings.HARD_DELETE_GRACE_DAYS)
    removed = {"media": 0, "posts": 0, "comments": 0, "users": 0, "objects": 0}

    # Media first: it owns bytes as well as rows.
    for media in Media.objects.filter(deleted_at__lt=cutoff).iterator():
        removed["objects"] += _purge_objects(client(), media)
        media.delete()
        removed["media"] += 1

    removed["posts"] = Post.objects.filter(deleted_at__lt=cutoff).delete()[0]
    removed["comments"] = Comment.objects.filter(deleted_at__lt=cutoff).delete()[0]

    # Accounts last: their content is reached through them, and cascading a
    # user away before its media is purged would strand the objects.
    for user in User.objects.filter(deleted_at__lt=cutoff).iterator():
        for media in Media.objects.filter(owner=user).iterator():
            removed["objects"] += _purge_objects(client(), media)
        user.delete()
        removed["users"] += 1

    logger.info("hard delete removed %s", removed)
    return removed


def _purge_objects(s3: S3Client, media: Media) -> int:
    """Delete every object belonging to one media row.

    Derivative keys are derivable from the id (see `core.media`), which is
    what makes this possible without a `derivatives` column.
    """
    from core.media import (
        DERIVATIVE_WIDTHS,
        derivative_key,
        object_key,
        poster_key,
        transcode_key,
    )

    keys = [
        object_key(media.pk, media.declared_mime),
        poster_key(media.pk),
        transcode_key(media.pk),
        *(derivative_key(media.pk, width) for width in DERIVATIVE_WIDTHS),
    ]

    deleted = 0
    for key in keys:
        try:
            s3.delete_object(Bucket=media.bucket, Key=key)
            deleted += 1
        except Exception:
            logger.debug("could not delete %s/%s", media.bucket, key)
    return deleted


@shared_task(name="moderation.report_escalation_backlog")
def report_escalation_backlog() -> int:
    """Count CSAM reports still awaiting escalation, and shout if any are.

    Cheap insurance against the failure mode the escalation task is designed
    to avoid: a report that quietly never went anywhere.
    """
    backlog = selectors.pending_escalations().count()
    if backlog:
        logger.critical("%s CSAM reports await escalation", backlog)
    return backlog
