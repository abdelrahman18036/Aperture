"""Reads for the posts app.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly -- that is what makes the block-filtering audit in
`01-ARCHITECTURE.md` §11 a one-file job instead of a forty-view job.

No `.count()` and no `COUNT(*)` on anything a request can reach: use the
`counters` app instead.

**The feed is the only architecture in this file.** Everything else is
plumbing. See `01-ARCHITECTURE.md` §7.
"""

from __future__ import annotations

from django.db.models import Prefetch, QuerySet

from posts import cache
from posts.models import Comment, Like, Post, PostMedia
from users.models import User
from users.selectors import accepted_followee_ids, exclude_blocked

#: One screenful and a bit. Cursor pagination means this is a page size, not a
#: ceiling on anything.
DEFAULT_PAGE_SIZE = 30
MAX_PAGE_SIZE = 60


def live() -> QuerySet[Post]:
    """Posts that are still visible to anyone at all. The base of every read.

    Three conditions, not one. A post is gone if *it* was deleted, and also if
    its author deleted their account or was suspended — §11 requires that a
    deleted account's content disappears from every read path, and the only
    way that stays true is for it to be in the base selector rather than
    remembered at each call site.
    """
    return Post.objects.filter(
        deleted_at__isnull=True,
        author__deleted_at__isnull=True,
        author__is_active=True,
    )


def _with_media(queryset: QuerySet[Post]) -> QuerySet[Post]:
    """Attach authors and media in a fixed number of queries.

    Without this a thirty-post feed is one query for the posts, thirty for the
    authors, thirty for the attachments and more for the media rows. The ORM
    hides that from you, which is exactly why rule 10 says to read the SQL it
    generates.
    """
    return (
        queryset.select_related(
            "author",
            "author__avatar_media",
            "link_preview",
            # A repost carries the original inline. One extra join rather than
            # one extra query per repost — the same reasoning as the line
            # above, applied to a row that is a post's whole content.
            #
            # Only one level deep, and that is a guarantee rather than a hope:
            # `repost` resolves a chain to its root, so a repost's
            # `reposted_from` is never itself a repost.
            "reposted_from",
            "reposted_from__author",
            "reposted_from__author__avatar_media",
            "reposted_from__link_preview",
        )
        .prefetch_related(
            Prefetch(
                "attachments",
                queryset=PostMedia.objects.select_related("media").order_by("position"),
            )
        )
        .prefetch_related(
            Prefetch(
                "reposted_from__attachments",
                queryset=PostMedia.objects.select_related("media").order_by("position"),
            )
        )
    )


def feed(
    *, viewer: User, cursor: int | None = None, limit: int = DEFAULT_PAGE_SIZE
) -> QuerySet[Post]:
    """The pull feed.

    `01-ARCHITECTURE.md` §7, as written:

        SELECT p.* FROM posts p
        JOIN follows f ON f.followee_id = p.author_id
        WHERE f.follower_id = $1 AND f.status = 'accepted'
          AND p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM blocks b ...)
          AND p.id < $2
        ORDER BY p.id DESC LIMIT 30;

    Always fresh, trivially correct, no invalidation bugs. Good into the low
    millions of posts given both `follows` indexes. **Start here and don't
    apologise for it.** Phase 8 adds a Redis cache and then hybrid push, and
    only on instrumentation.

    The cursor is a snowflake, which is why this needs no `created_at`
    comparison and no tie-breaking: ids are time-ordered, so `id < cursor` *is*
    "older than that post", and the partial index on
    `(id DESC) WHERE deleted_at IS NULL` serves the ordering directly.

    **This function is still the source of truth.** `cached_feed` below layers
    Redis over it; every path through that layer ends up here on a miss, and
    the visibility rules are applied to the rows either way.
    """
    posts = live().filter(
        author_id__in=accepted_followee_ids(viewer),
        visibility__in=[Post.Visibility.PUBLIC, Post.Visibility.FOLLOWERS],
    )

    # Rule 8. One helper, one place to be wrong.
    posts = exclude_blocked(posts, viewer, author_field="author_id")

    if cursor is not None:
        posts = posts.filter(id__lt=cursor)

    return _with_media(posts).order_by("-id")[: min(limit, MAX_PAGE_SIZE)]


def cached_feed(
    *, viewer: User, cursor: int | None = None, limit: int = DEFAULT_PAGE_SIZE
) -> list[Post]:
    """The feed, through the Redis cache — §7 phase 2.

    Returns a list rather than a queryset, deliberately. A cache hit is a set
    of ids and a fetch; there is no queryset that means both that and the
    uncached query, and pretending otherwise would hand callers something that
    silently changes shape depending on Redis.

    **A hit still re-applies every visibility rule.** The ids come from Redis
    and the rows come from `live()` with the block filter over them, so a post
    deleted, or an author suspended, or a block created since the set was
    written all take effect on this read. That is the property that makes
    caching ids safe where caching posts would not be.

    A hit that comes back short is treated as the end of the cached range and
    falls through to Postgres, because a cache holds `MAX_ENTRIES` and a feed
    does not — the alternative is a scroll that mysteriously stops.
    """
    ids = cache.get_page(user_id=viewer.pk, cursor=cursor, limit=limit)

    if ids is not None and len(ids) >= limit:
        rows = _with_media(
            exclude_blocked(
                live().filter(
                    id__in=ids,
                    visibility__in=[
                        Post.Visibility.PUBLIC,
                        Post.Visibility.FOLLOWERS,
                    ],
                ),
                viewer,
                author_field="author_id",
            )
        )
        by_id = {post.pk: post for post in rows}
        # Redis decided the order; rebuild it rather than re-sorting, so the
        # cached page and the uncached one cannot disagree about sequence.
        return [by_id[pk] for pk in ids if pk in by_id]

    posts = list(feed(viewer=viewer, cursor=cursor, limit=limit))

    # Only the first page is cached. See `cache.store` for why a deep page
    # would leave a hole the sorted set cannot express.
    if cursor is None:
        cache.store(user_id=viewer.pk, post_ids=[post.pk for post in posts])

    return posts


def explore(
    *, viewer: User | None, cursor: int | None = None, limit: int = 30
) -> QuerySet[Post]:
    """Recent public posts from accounts the viewer does not already follow.

    The feed answers "what did the people I chose post?"; this answers "who
    else is here?", and they are different questions — an explore grid that
    repeats your feed is a second copy of a page you have already read.

    Private accounts are excluded outright rather than filtered per-viewer.
    Someone who set their account private did not opt into being discovered,
    and `can_view_posts` would let a follower see them here, which is the
    wrong answer for a discovery surface even though it is the right one for
    a profile.

    Same cursor shape as the feed: a snowflake, descending. No offsets, so
    nothing shifts or repeats while someone is scrolling.
    """
    posts = live().filter(author__is_private=False)

    if viewer is not None and viewer.is_authenticated:
        # Your own posts and the ones you already follow belong in the feed.
        posts = posts.exclude(author=viewer).exclude(
            author_id__in=accepted_followee_ids(viewer)
        )

    posts = exclude_blocked(posts, viewer)

    if cursor is not None:
        posts = posts.filter(id__lt=cursor)

    return _with_media(posts).order_by("-id")[:limit]


def by_author(
    *,
    viewer: User | None,
    author: User,
    cursor: int | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> QuerySet[Post]:
    """The profile contact sheet.

    Served by the `(author_id, id DESC)` index. Callers must have already
    established that the viewer may see this author at all — see
    `users.selectors.can_view_posts`.
    """
    posts = live().filter(author=author)

    if viewer is None or viewer.pk != author.pk:
        posts = posts.exclude(visibility=Post.Visibility.PRIVATE)

    posts = exclude_blocked(posts, viewer, author_field="author_id")

    if cursor is not None:
        posts = posts.filter(id__lt=cursor)

    return _with_media(posts).order_by("-id")[: min(limit, MAX_PAGE_SIZE)]


def visible_post(*, viewer: User | None, post_id: int) -> Post | None:
    """One post, if the viewer is allowed it."""
    posts = exclude_blocked(live(), viewer, author_field="author_id")
    return _with_media(posts).filter(pk=post_id).first()


def liked_post_ids(*, viewer: User | None, post_ids: list[int]) -> set[int]:
    """Which of these posts the viewer has already liked, in one query.

    Asking per post would be an N+1 on the hottest page in the product.
    """
    if viewer is None or not viewer.is_authenticated or not post_ids:
        return set()
    return set(
        Like.objects.filter(user=viewer, post_id__in=post_ids).values_list(
            "post_id", flat=True
        )
    )


def comments_for(
    *,
    viewer: User | None,
    post: Post,
    cursor: int | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> QuerySet[Comment]:
    """Top-level comments on a post, oldest first.

    Block-filtered like everything else: someone you blocked must not be able
    to talk to you underneath a photograph.
    """
    comments = Comment.objects.filter(
        post=post,
        parent__isnull=True,
        deleted_at__isnull=True,
        author__deleted_at__isnull=True,
        author__is_active=True,
    ).select_related("author", "author__avatar_media")

    comments = exclude_blocked(comments, viewer, author_field="author_id")

    if cursor is not None:
        comments = comments.filter(id__gt=cursor)

    return comments.order_by("id")[: min(limit, MAX_PAGE_SIZE)]


def replies_to(
    *, viewer: User | None, comment: Comment, limit: int = DEFAULT_PAGE_SIZE
) -> QuerySet[Comment]:
    replies = Comment.objects.filter(
        parent=comment,
        deleted_at__isnull=True,
        author__deleted_at__isnull=True,
        author__is_active=True,
    ).select_related("author", "author__avatar_media")
    replies = exclude_blocked(replies, viewer, author_field="author_id")
    return replies.order_by("id")[: min(limit, MAX_PAGE_SIZE)]


def comment_owned_by(*, author: User, comment_id: int) -> Comment | None:
    return Comment.objects.filter(
        pk=comment_id, author=author, deleted_at__isnull=True
    ).first()


def post_owned_by(*, author: User, post_id: int) -> Post | None:
    return live().filter(pk=post_id, author=author).first()


def reposted_post_ids(*, viewer: User | None, post_ids: list[int]) -> set[int]:
    """Which of these the viewer has reposted. One query for the page.

    Keyed on the *original*, because that is what the button sits under: a
    repost on somebody's own feed shows the original's state, and asking "have
    I reposted this" about a repost means asking about what it came from.
    """
    if viewer is None or not post_ids:
        return set()
    return set(
        Post.objects.filter(
            author=viewer,
            reposted_from_id__in=post_ids,
            deleted_at__isnull=True,
        ).values_list("reposted_from_id", flat=True)
    )
