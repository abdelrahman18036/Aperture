"""Celery tasks for the stories app."""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from stories.models import Story

logger = logging.getLogger(__name__)

#: How long an expired story's row survives before the ordinary hard-delete
#: path can take it. A day past expiry, so "it vanished at 24 hours" and "it
#: is recoverable for a moment after" are both true.
GRACE_HOURS = 24


@shared_task(name="stories.reap_expired")
def reap_expired() -> int:
    """Soft-delete stories that lapsed a day ago.

    **Nothing about visibility depends on this task.** `expires_at` is
    filtered on every read, so a story is gone from every surface the instant
    it lapses whether or not a worker is running — that is the guarantee
    somebody posting to a story is trusting, and it cannot be left to a queue.

    What this does is move lapsed rows onto the existing soft-delete path so
    the scheduled hard delete eventually erases them, rather than letting the
    table grow forever with content nobody can see.
    """
    cutoff = timezone.now() - timedelta(hours=GRACE_HOURS)
    reaped = Story.objects.filter(
        deleted_at__isnull=True, expires_at__lt=cutoff
    ).update(deleted_at=timezone.now())

    if reaped:
        logger.info("reaped %s expired stories", reaped)
    return reaped
