"""Reads for the users app — and the one place block filtering is defined.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly.

`01-ARCHITECTURE.md` §11 requires that **every read path returning user
content filters blocks** — feed, search, comments, DMs, notifications. The
only way that stays true across forty views is for there to be exactly one
helper, which is `exclude_blocked()` below. Other apps' selectors import it;
that is allowed, because apps may depend on each other's selectors and
services, just never on each other's internals.

No `.count()` and no `COUNT(*)` on anything a request can reach: use the
`counters` app instead.
"""

from __future__ import annotations

from django.db.models import Model, Q, QuerySet

from users.models import Block, Follow, User

# ---------------------------------------------------------------------------
# Blocking — rule 8's single audit point
# ---------------------------------------------------------------------------


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


def is_blocked_between(viewer: User | None, other: User) -> bool:
    """Whether either has blocked the other.

    Used where filtering a queryset is the wrong shape — a profile page is one
    row, and the answer decides 404 rather than which rows to drop.
    """
    if viewer is None or not viewer.is_authenticated:
        return False
    if viewer.pk == other.pk:
        return False
    return Block.objects.filter(
        Q(blocker=viewer, blocked=other) | Q(blocker=other, blocked=viewer)
    ).exists()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def live() -> QuerySet[User]:
    """Accounts that still exist. A deleted account is gone from every read.

    `avatar_media` is joined here rather than at each call site because
    `UserSerializer` reads it for every user it renders — a search returning
    twenty accounts would otherwise be twenty extra queries, which is the
    N+1 rule 10 asks to be looked for rather than assumed absent.
    """
    return User.objects.filter(deleted_at__isnull=True, is_active=True).select_related(
        "avatar_media"
    )


def by_username(username: str) -> User | None:
    """Case-insensitively, because the column's collation is."""
    return live().filter(username=username).first()


def visible_profile(*, viewer: User | None, username: str) -> User | None:
    """A profile, or None if it does not exist or is hidden from the viewer.

    A blocked account is indistinguishable from a missing one on purpose:
    "this user has blocked you" is information the blocker did not agree to
    share.
    """
    user = by_username(username)
    if user is None:
        return None
    if is_blocked_between(viewer, user):
        return None
    return user


def search(*, viewer: User | None, query: str, limit: int = 20) -> QuerySet[User]:
    """Username and display-name search, block-filtered.

    Rule 8 applies here as much as to the feed — being blocked and still
    turning up in search is the same failure wearing a hat.
    """
    if not query.strip():
        return live().none()
    matches = live().filter(
        Q(username__icontains=query) | Q(display_name__icontains=query)
    )
    return exclude_blocked(matches, viewer, author_field="id").order_by("username")[
        :limit
    ]


# ---------------------------------------------------------------------------
# Follows
# ---------------------------------------------------------------------------


def follow_between(*, follower: User, followee: User) -> Follow | None:
    return Follow.objects.filter(follower=follower, followee=followee).first()


def follow_states(*, viewer: User | None, user_ids: list[int]) -> dict[int, str]:
    """The viewer's follow state toward many users, in one query.

    Batched for the same reason the counters are: rendering a feed asks this
    about every author on the page.
    """
    if viewer is None or not viewer.is_authenticated or not user_ids:
        return {}
    rows = Follow.objects.filter(follower=viewer, followee_id__in=user_ids).values_list(
        "followee_id", "status"
    )
    return dict(rows)


def accepted_followee_ids(user: User) -> QuerySet[Follow, int]:
    """Who this user actually follows. The feed's join, as a subquery."""
    return Follow.objects.filter(
        follower=user, status=Follow.Status.ACCEPTED
    ).values_list("followee_id", flat=True)


def pending_requests_for(user: User, *, limit: int = 50) -> QuerySet[Follow]:
    """Follow requests awaiting this user's approval. Private accounts only.

    Bounded, because this list has no natural ceiling. A seeded account here
    already had 315 pending — a real private account that gets linked
    somewhere has orders of magnitude more, and an unbounded query means the
    response, the serialisation and the DOM all grow with it. Fifty is a
    screenful; the rest arrive as these are answered.
    """
    return (
        Follow.objects.filter(followee=user, status=Follow.Status.PENDING)
        .select_related("follower", "follower__avatar_media")
        .order_by("-id")[:limit]
    )


def can_view_posts(*, viewer: User | None, author: User) -> bool:
    """Whether the viewer may see this author's posts.

    Public accounts are public. A private account is visible to itself and to
    accepted followers, and to nobody else.
    """
    if is_blocked_between(viewer, author):
        return False
    if not author.is_private:
        return True
    if viewer is None or not viewer.is_authenticated:
        return False
    if viewer.pk == author.pk:
        return True
    return Follow.objects.filter(
        follower=viewer, followee=author, status=Follow.Status.ACCEPTED
    ).exists()
