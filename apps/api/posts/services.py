"""Writes for the posts app.

Business transactions live here, and this is the only place `.save()` is
called. Anything published to Redis is published *after* the transaction
commits, never inside it -- see `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from config import broadcast
from counters import services as counter_services
from counters.models import Counter
from counters.tasks import adjust
from links import services as link_services
from media.models import Media
from notifications.models import Notification
from notifications.services import notify, withdraw
from posts import cache
from posts.models import Comment, Like, Post, PostMedia
from users.models import Follow, User
from users.selectors import can_view_posts

MAX_MEDIA_PER_POST = 10


class PostRejectedError(Exception):
    """The post cannot be created. The message is safe to show a user."""


class NotAllowedError(Exception):
    """An action the caller is not entitled to take."""


def _bump(entity_type: str, entity_id: int, metric: str, delta: int) -> None:
    """Enqueue a counter move once the surrounding transaction commits."""

    def move() -> None:
        # Visible now, durable shortly. See `counters.services.apply_now`
        # — the cache is the read path, so this is what makes the count
        # in the response the count the client should render.
        counter_services.apply_now(
            entity_type=entity_type,
            entity_id=entity_id,
            metric=metric,
            delta=delta,
        )
        adjust.delay(entity_type, entity_id, metric, delta)

    transaction.on_commit(move)


@transaction.atomic
def create_post(
    *,
    author: User,
    media_ids: list[int],
    caption: str = "",
    location: str = "",
    visibility: str = Post.Visibility.PUBLIC,
) -> Post:
    """Publish a post from media that is already uploaded and processed.

    Media must be the author's own and `ready`. Both checks matter: the first
    stops someone attaching a stranger's photograph by guessing an id, and the
    second stops a post existing with an image that turns out to be corrupt.
    """
    if not media_ids:
        raise PostRejectedError("A post needs at least one photograph.")
    if len(media_ids) > MAX_MEDIA_PER_POST:
        raise PostRejectedError(f"A post may hold at most {MAX_MEDIA_PER_POST} items.")

    media = list(
        Media.objects.filter(
            pk__in=media_ids,
            owner=author,
            state=Media.State.READY,
            deleted_at__isnull=True,
        )
    )
    if len(media) != len(set(media_ids)):
        raise PostRejectedError(
            "Some of that media is missing, still processing, or not yours."
        )

    post = Post.objects.create(
        author=author,
        # The first link in the caption, if any. Resolving it costs one query
        # against a cache keyed on the URL; fetching it happens on the queue
        # after commit, so publishing never waits on somebody else's server.
        link_preview=link_services.preview_for(caption),
        caption=caption,
        location=location,
        visibility=visibility,
    )

    # Preserve the order the client sent, not the order the database returned.
    by_id = {item.pk: item for item in media}
    PostMedia.objects.bulk_create(
        [
            PostMedia(post=post, media=by_id[media_id], position=position)
            for position, media_id in enumerate(media_ids)
        ]
    )

    _bump(Counter.EntityType.USER, author.pk, Counter.Metric.POSTS, 1)

    # §7: "invalidated on a followee's new post". After commit, never inside
    # it — rule 11 is about socket events but the reasoning is identical here.
    # A cache updated inside a transaction that then rolls back is a feed
    # holding a post that does not exist, and it holds it for thirty minutes.
    transaction.on_commit(lambda: _fan_out_to_feeds(post))

    # And to whoever is watching right now. The same after-commit rule, and
    # the same reasoning as the cache above: announcing a post that then rolls
    # back is worse than announcing it a moment late.
    audience = _follower_ids(author)
    post_id = str(post.pk)
    transaction.on_commit(
        lambda: broadcast.publish_to_users(
            user_ids=audience,
            event_type="post.created",
            payload={"post_id": post_id, "author_id": str(author.pk)},
        )
    )

    return post


def _follower_ids(author: User) -> list[int]:
    """Who to tell about a new post.

    Ids only. The feed applies visibility, blocks and privacy, and a payload
    carrying the post would need every one of those checks re-implemented for
    the wire — so the client is told *that* something arrived and fetches it
    through the path that already gets that right.
    """
    return list(
        Follow.objects.filter(
            followee=author, status=Follow.Status.ACCEPTED
        ).values_list("follower_id", flat=True)
    )


def _fan_out_to_feeds(post: Post) -> None:
    """Put a new post into the feed caches that already exist.

    Synchronous, and that is a decision with a limit on it. Reading the
    follower ids and pushing one id into each sorted set is cheap for the
    accounts this product has; for an account with a million followers it is
    not, and that is precisely the case §7 answers with hybrid push — "except
    accounts over ~10k followers, which stay pull and merge in at read time".
    That threshold is not implemented, because the instrumentation says it is
    not needed yet; when it is, this is the function it changes.

    `push` only touches feeds that already exist, so this costs nothing for
    followers who have not read recently.
    """
    from users.models import Follow

    follower_ids = list(
        Follow.objects.filter(
            followee_id=post.author_id, status=Follow.Status.ACCEPTED
        ).values_list("follower_id", flat=True)
    )
    cache.push(user_ids=follower_ids, post_id=post.pk)


@transaction.atomic
def repost(*, user: User, post: Post, caption: str = "") -> Post:
    """Put somebody else's post on your own feed, under your name.

    A repost is a real `Post` pointing at the original, so it fans out, is
    cursor-paginated and can be deleted through every path that already exists.
    It carries no media of its own — the original's is rendered through it.

    **The chain is flattened.** Reposting a repost points at the root, so
    nothing ever has to walk a list to find the photograph, and the count on
    the original is the true one rather than the top of a chain.

    Idempotent: reposting twice returns the repost you already have.
    """
    original = post.reposted_from or post

    if original.author_id == user.pk:
        raise PostRejectedError("That is already yours.")
    if not can_view_posts(viewer=user, author=original.author):
        raise NotAllowedError("That post is unavailable.")

    existing = Post.objects.filter(
        author=user, reposted_from=original, deleted_at__isnull=True
    ).first()
    if existing is not None:
        return existing

    made = Post.objects.create(
        author=user,
        reposted_from=original,
        caption=caption,
        visibility=original.visibility,
    )

    _bump(Counter.EntityType.POST, original.pk, Counter.Metric.REPOSTS, 1)
    _bump(Counter.EntityType.USER, user.pk, Counter.Metric.POSTS, 1)

    transaction.on_commit(lambda: _fan_out_to_feeds(made))
    audience = _follower_ids(user)
    made_id = str(made.pk)
    transaction.on_commit(
        lambda: broadcast.publish_to_users(
            user_ids=audience,
            event_type="post.created",
            payload={"post_id": made_id, "author_id": str(user.pk)},
        )
    )

    notify(
        recipient=original.author,
        actor=user,
        verb=Notification.Verb.REPOST,
        post=original,
    )
    return made


@transaction.atomic
def undo_repost(*, user: User, post: Post) -> bool:
    """Take your repost back. Returns False if there was nothing to take back."""
    original = post.reposted_from or post
    mine = Post.objects.filter(
        author=user, reposted_from=original, deleted_at__isnull=True
    ).first()
    if mine is None:
        return False

    soft_delete_post(post=mine)
    _bump(Counter.EntityType.POST, original.pk, Counter.Metric.REPOSTS, -1)
    withdraw(
        recipient=original.author,
        actor=user,
        verb=Notification.Verb.REPOST,
        post=original,
    )
    return True


@transaction.atomic
def soft_delete_post(*, post: Post) -> Post:
    """Soft delete, plus a scheduled hard delete. See §11."""
    if post.deleted_at is not None:
        return post
    post.deleted_at = timezone.now()
    post.save(update_fields=["deleted_at"])
    _bump(Counter.EntityType.USER, post.author_id, Counter.Metric.POSTS, -1)
    return post


# ---------------------------------------------------------------------------
# Likes
# ---------------------------------------------------------------------------


@transaction.atomic
def like(*, user: User, post: Post) -> bool:
    """Like a post. Returns whether this call was the one that did it.

    Idempotent through the unique constraint rather than a read-then-write:
    double-tapping twice in the same instant must not produce two likes or an
    error, and only the database can arbitrate that.
    """
    if not can_view_posts(viewer=user, author=post.author):
        raise NotAllowedError("That post is unavailable.")

    try:
        Like.objects.create(user=user, post=post)
    except IntegrityError:
        return False

    _bump(Counter.EntityType.POST, post.pk, Counter.Metric.LIKES, 1)
    notify(
        recipient=post.author,
        actor=user,
        verb=Notification.Verb.LIKE,
        post=post,
    )
    return True


@transaction.atomic
def unlike(*, user: User, post: Post) -> bool:
    """Remove a like. Returns whether there was one to remove."""
    deleted, _ = Like.objects.filter(user=user, post=post).delete()
    if not deleted:
        return False
    _bump(Counter.EntityType.POST, post.pk, Counter.Metric.LIKES, -1)
    # The notification goes with the like. "Ada liked your post" surviving
    # Ada changing her mind is a small lie with no reason to exist.
    withdraw(
        recipient=post.author,
        actor=user,
        verb=Notification.Verb.LIKE,
        post=post,
    )
    return True


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


@transaction.atomic
def add_comment(
    *, author: User, post: Post, body: str, parent: Comment | None = None
) -> Comment:
    if not body.strip():
        raise PostRejectedError("A comment needs something in it.")
    if not can_view_posts(viewer=author, author=post.author):
        raise NotAllowedError("That post is unavailable.")
    if parent is not None and parent.post_id != post.pk:
        raise NotAllowedError("That comment belongs to a different post.")
    if parent is not None and parent.parent_id is not None:
        # One level of nesting. Threads deeper than that are unreadable on a
        # 640px column and nobody has ever wanted them.
        parent = parent.parent

    comment = Comment.objects.create(post=post, author=author, parent=parent, body=body)

    # The post's author, and — for a reply — the person being replied to.
    # `notify` drops anything aimed at yourself, so a self-reply on your own
    # post produces nothing rather than two rows.
    notify(
        recipient=post.author,
        actor=author,
        verb=Notification.Verb.COMMENT,
        post=post,
        comment=comment,
    )
    if parent is not None:
        notify(
            recipient=parent.author,
            actor=author,
            verb=Notification.Verb.COMMENT,
            post=post,
            comment=comment,
        )

    _bump(Counter.EntityType.POST, post.pk, Counter.Metric.COMMENTS, 1)
    if parent is not None:
        _bump(Counter.EntityType.COMMENT, parent.pk, Counter.Metric.REPLIES, 1)

    return comment


@transaction.atomic
def soft_delete_comment(*, comment: Comment) -> Comment:
    if comment.deleted_at is not None:
        return comment
    comment.deleted_at = timezone.now()
    comment.save(update_fields=["deleted_at"])
    _bump(Counter.EntityType.POST, comment.post_id, Counter.Metric.COMMENTS, -1)
    if comment.parent_id is not None:
        _bump(Counter.EntityType.COMMENT, comment.parent_id, Counter.Metric.REPLIES, -1)
    return comment
