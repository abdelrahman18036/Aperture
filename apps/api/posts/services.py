"""Writes for the posts app.

Business transactions live here, and this is the only place `.save()` is
called. Anything published to Redis is published *after* the transaction
commits, never inside it -- see `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from counters.models import Counter
from counters.tasks import adjust
from media.models import Media
from posts.models import Comment, Like, Post, PostMedia
from users.models import User
from users.selectors import can_view_posts

MAX_MEDIA_PER_POST = 10


class PostRejectedError(Exception):
    """The post cannot be created. The message is safe to show a user."""


class NotAllowedError(Exception):
    """An action the caller is not entitled to take."""


def _bump(entity_type: str, entity_id: int, metric: str, delta: int) -> None:
    """Enqueue a counter move once the surrounding transaction commits."""
    transaction.on_commit(lambda: adjust.delay(entity_type, entity_id, metric, delta))


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
    return post


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
    return True


@transaction.atomic
def unlike(*, user: User, post: Post) -> bool:
    """Remove a like. Returns whether there was one to remove."""
    deleted, _ = Like.objects.filter(user=user, post=post).delete()
    if not deleted:
        return False
    _bump(Counter.EntityType.POST, post.pk, Counter.Metric.LIKES, -1)
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
