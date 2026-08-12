"""Reads for the notifications app."""

from __future__ import annotations

from django.db.models import QuerySet

from notifications.models import Notification
from users.models import User
from users.selectors import exclude_blocked

DEFAULT_PAGE_SIZE = 30


def live(user: User) -> QuerySet[Notification]:
    """Everything worth showing this user, newest first.

    **Rule 8 applies here as much as to a feed.** `01-ARCHITECTURE.md` §11
    names notifications in the list of read paths blocking must cover, and it
    is an obvious one once stated: a notification is somebody else's name and
    face on your screen, which is exactly what blocking them is for.

    Actors whose accounts are gone are filtered too — a row survives its
    subject being soft-deleted, and "someone liked your post" pointing at
    nothing is worse than silence.
    """
    rows = Notification.objects.filter(
        recipient=user,
        actor__deleted_at__isnull=True,
        actor__is_active=True,
    ).select_related("actor", "actor__avatar_media", "post", "comment", "story")

    return exclude_blocked(rows, viewer=user, author_field="actor_id").order_by("-id")


def page(
    *, user: User, before_id: int | None = None, limit: int = DEFAULT_PAGE_SIZE
) -> QuerySet[Notification]:
    """One screenful, walked by cursor on the snowflake id."""
    rows = live(user)
    if before_id is not None:
        rows = rows.filter(id__lt=before_id)
    return rows[:limit]


def unread_count(user: User) -> int:
    """How many are new.

    The one `COUNT(*)` on a request path in this codebase, and it is allowed
    because of the shape: it is served entirely by the
    `(recipient, read_at)` index over one person's rows, which is bounded by
    how much attention one account attracts rather than by the size of the
    table. Rule 9 is about counts over other people's content.
    """
    return live(user).filter(read_at__isnull=True).count()
