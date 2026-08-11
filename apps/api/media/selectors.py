"""Reads for the media app.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly -- that is what makes the block-filtering audit in
`01-ARCHITECTURE.md` §11 a one-file job instead of a forty-view job.

No `.count()` and no `COUNT(*)` on anything a request can reach: use the
`counters` app instead.
"""

from __future__ import annotations

from django.db.models import QuerySet

from media.models import Media
from users.models import User
from users.selectors import exclude_blocked


def live() -> QuerySet[Media]:
    """Every media row that has not been soft-deleted. The base of everything."""
    return Media.objects.filter(deleted_at__isnull=True)


def owned_by(owner: User) -> QuerySet[Media]:
    """Someone's own media, in reverse chronological order.

    Includes rows that are still `pending` or have `failed`: you are entitled
    to see your own upload fail.
    """
    return live().filter(owner=owner).order_by("-id")


def visible_to(viewer: User | None) -> QuerySet[Media]:
    """Ready media the viewer is allowed to see.

    Rule 8 lives here for this app. Every read path that returns another
    user's media goes through this, so the block filter has exactly one place
    to be wrong.
    """
    queryset = live().filter(state=Media.State.READY)
    return exclude_blocked(queryset, viewer, author_field="owner_id")


def for_owner_or_none(*, owner: User, media_id: int) -> Media | None:
    """One row, but only if it belongs to this user."""
    return owned_by(owner).filter(pk=media_id).first()


def stale_pending(*, older_than_seconds: int) -> QuerySet[Media]:
    """Intents whose bytes never arrived.

    A presigned URL expires in five minutes; a row still `pending` well after
    that is an upload the browser abandoned. Phase 5's scheduled jobs reap
    these -- the query lives here now so it is written once.
    """
    from datetime import timedelta

    from django.utils import timezone

    cutoff = timezone.now() - timedelta(seconds=older_than_seconds)
    return live().filter(state=Media.State.PENDING, created_at__lt=cutoff)
