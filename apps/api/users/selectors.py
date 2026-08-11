"""Reads for the users app — and the one place block filtering is defined.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly.

`01-ARCHITECTURE.md` §11 requires that **every read path returning user
content filters blocks** — feed, search, comments, DMs, notifications. The
only way that stays true across forty views is for there to be exactly one
helper, which is `exclude_blocked()` below. Other apps' selectors import it;
that is allowed, because apps may depend on each other's selectors and
services, just never on each other's internals.

It is here in Phase 1, unused, because retrofitting it means auditing every
query ever written. From Phase 3 it is non-negotiable.

No `.count()` and no `COUNT(*)` on anything a request can reach: use the
`counters` app instead.
"""

from __future__ import annotations

from django.db.models import Model, Q, QuerySet

from users.models import Block, User


def blocked_ids(viewer: User) -> set[int]:
    """User IDs invisible to `viewer`, in **both** directions.

    A block hides the blocker from the blocked as well. Filtering one
    direction only is the bug that makes blocking feel useless — the blocked
    account can still watch.

    Materialised as a set rather than left as a subquery: block lists are
    short by nature, so one small query beats a correlated subquery evaluated
    per row, and the result is cacheable for the life of a request.
    """
    pairs = Block.objects.filter(Q(blocker=viewer) | Q(blocked=viewer)).values_list(
        "blocker_id", "blocked_id"
    )
    viewer_id = viewer.pk
    return {
        blocked_id if blocker_id == viewer_id else blocker_id
        for blocker_id, blocked_id in pairs
    }


def exclude_blocked[M: Model](
    queryset: QuerySet[M],
    viewer: User | None,
    *,
    author_field: str = "author_id",
) -> QuerySet[M]:
    """Drop rows authored by anyone in a block relationship with `viewer`.

    The single audit point for rule 8. An anonymous viewer has no blocks, so
    the queryset passes through untouched.

    `author_field` names the column holding the content's author: `author_id`
    for posts and comments, `owner_id` for media, `sender_id` for messages,
    `id` for a queryset of users themselves.
    """
    if viewer is None or not viewer.is_authenticated:
        return queryset
    hidden = blocked_ids(viewer)
    if not hidden:
        return queryset
    return queryset.exclude(**{f"{author_field}__in": hidden})
