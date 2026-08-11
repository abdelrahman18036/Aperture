"""Celery tasks for the counters app.

Counters move on the queue, not on the request. A like should return as soon
as the row is written; whether the displayed total has caught up a beat later
is not something anyone notices, and it keeps the write path short.

Every caller enqueues these with `transaction.on_commit`, so a rolled-back
like never increments anything.
"""

from __future__ import annotations

from celery import shared_task

from counters import services
from counters.models import Counter


@shared_task(name="counters.adjust")
def adjust(entity_type: str, entity_id: int, metric: str, delta: int = 1) -> int:
    """Move one counter. The single task behind every count in the product."""
    services.increment(
        entity_type=entity_type, entity_id=entity_id, metric=metric, delta=delta
    )
    return delta


@shared_task(name="counters.recompute_post")
def recompute_post(post_id: int) -> dict[str, int]:
    """Recount one post from source. Repair path, never a request path.

    This is the only place a `COUNT(*)` is allowed to exist, and it is allowed
    because it runs on the queue against one row's children — not on a feed
    render for a thousand.
    """
    from posts.models import Comment, Like

    likes = Like.objects.filter(post_id=post_id).count()
    comments = Comment.objects.filter(post_id=post_id, deleted_at__isnull=True).count()

    services.set_value(
        entity_type=Counter.EntityType.POST,
        entity_id=post_id,
        metric=Counter.Metric.LIKES,
        value=likes,
    )
    services.set_value(
        entity_type=Counter.EntityType.POST,
        entity_id=post_id,
        metric=Counter.Metric.COMMENTS,
        value=comments,
    )
    return {"likes": likes, "comments": comments}


@shared_task(name="counters.recompute_user")
def recompute_user(user_id: int) -> dict[str, int]:
    """Recount one user from source. Repair path."""
    from posts.models import Post
    from users.models import Follow

    followers = Follow.objects.filter(
        followee_id=user_id, status=Follow.Status.ACCEPTED
    ).count()
    following = Follow.objects.filter(
        follower_id=user_id, status=Follow.Status.ACCEPTED
    ).count()
    posts = Post.objects.filter(author_id=user_id, deleted_at__isnull=True).count()

    for metric, value in (
        (Counter.Metric.FOLLOWERS, followers),
        (Counter.Metric.FOLLOWING, following),
        (Counter.Metric.POSTS, posts),
    ):
        services.set_value(
            entity_type=Counter.EntityType.USER,
            entity_id=user_id,
            metric=metric,
            value=value,
        )

    return {"followers": followers, "following": following, "posts": posts}
