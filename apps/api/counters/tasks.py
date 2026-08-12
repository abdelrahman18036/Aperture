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


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------
#
# **Counters drift, and this is the only thing that fixes it.** The two
# `recompute_*` tasks above have existed since Phase 3 as a "repair path" and
# nothing outside `seed_demo` ever called them, which meant the repair path
# was theoretical: a count that went wrong stayed wrong for the life of the
# row. It goes wrong for ordinary reasons —
#
#   * the worker was not running when the increment was enqueued, which is the
#     everyday case in development and the deploy-window case in production;
#   * a task was lost. `adjust` is deliberately at-most-once: `increment` is
#     not idempotent, so `acks_late` would trade a missed increment for a
#     double-counted one, and a like that shows twice is worse than one that
#     shows a minute late.
#
# So the design is at-most-once plus reconciliation, which is the usual answer
# for counters and only works if the reconciliation actually runs.
#
# It walks a slice per run rather than the whole table. A full recount is a
# `COUNT(*)` per entity per metric, and doing that for every user at once is
# precisely the query rule 9 exists to keep off the database — the fact that
# it is on the queue makes it allowed, not free.

#: Where the last sweep stopped. Snowflakes are ordered, so "id greater than
#: the cursor" walks the table once and wraps.
_CURSOR_KEY = "counters:reconcile:cursor:{kind}"

#: A day's TTL, so an idle deployment restarts the sweep rather than resuming
#: against ids that may no longer exist.
_CURSOR_TTL_SECONDS = 60 * 60 * 24


@shared_task(name="counters.reconcile")
def reconcile(batch_size: int = 200) -> dict[str, int]:
    """Recount one slice of users and posts, then remember where to resume.

    Returns what it touched, so a run that repairs nothing is distinguishable
    in the logs from one that never ran.
    """
    from django.core.cache import cache

    from posts.models import Post
    from users.models import User

    repaired = {"users": 0, "posts": 0}

    for kind, model, recompute in (
        ("user", User, recompute_user),
        ("post", Post, recompute_post),
    ):
        key = _CURSOR_KEY.format(kind=kind)
        cursor: int = cache.get(key, 0)

        ids = list(
            model.objects.filter(pk__gt=cursor)
            .order_by("pk")
            .values_list("pk", flat=True)[:batch_size]
        )
        if not ids:
            # Wrapped. Start again from the beginning on the next run rather
            # than sitting at the end doing nothing.
            cache.set(key, 0, timeout=_CURSOR_TTL_SECONDS)
            continue

        for entity_id in ids:
            # Called directly, not enqueued. This task is already on the
            # queue, and fanning out one message per row would turn a slice
            # of 200 into 200 messages for no benefit.
            recompute(entity_id)

        repaired[f"{kind}s"] = len(ids)
        cache.set(key, ids[-1], timeout=_CURSOR_TTL_SECONDS)

    return repaired
