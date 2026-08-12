"""Tests for the reconciliation task and the `recount` command.

Both exist because the two `recompute_*` tasks had no caller outside
`seed_demo` — a repair path nothing could reach is a repair path that does not
exist. What is being pinned here is that drift is *detected and corrected*,
whatever caused it, rather than any particular cause of it.

Worth stating, because it was briefly believed otherwise while this was
written: a counter that has not moved yet is not drift. `adjust` is enqueued
with `transaction.on_commit` and waits in Redis, so a count that looks wrong
while no worker is running is correct the moment one starts. Drift is the
narrower thing — a task that was lost, errored, or never enqueued at all.
"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from django.core.management import CommandError, call_command

from counters import services, tasks
from counters.models import Counter
from posts.models import Post
from users.models import Follow, User

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _no_cursor() -> None:
    """The sweep cursor lives in Redis, outside the test transaction."""
    cache.delete("counters:reconcile:cursor:user")
    cache.delete("counters:reconcile:cursor:post")


def stored(entity_type: str, entity_id: int, metric: str) -> int:
    row = Counter.objects.filter(
        entity_type=entity_type, entity_id=entity_id, metric=metric
    ).first()
    return 0 if row is None else row.value


def follow(follower: User, followee: User) -> None:
    Follow.objects.create(
        follower=follower, followee=followee, status=Follow.Status.ACCEPTED
    )


class TestReconcile:
    def test_it_corrects_a_counter_that_was_never_written(
        self, user: User, other_user: User
    ) -> None:
        # The row exists and the counter does not — an increment that was
        # lost rather than merely late.
        follow(other_user, user)
        assert stored("user", user.pk, "followers") == 0

        tasks.reconcile()

        assert stored("user", user.pk, "followers") == 1

    def test_it_corrects_a_counter_that_is_too_high(
        self, user: User, other_user: User
    ) -> None:
        # Double delivery is the failure mode on the other side of
        # at-most-once, and the one a retry policy would introduce.
        services.increment(
            entity_type="user", entity_id=user.pk, metric="followers", delta=5
        )

        tasks.reconcile()

        assert stored("user", user.pk, "followers") == 0

    def test_it_counts_posts_too(self, user: User) -> None:
        post = Post.objects.create(author=user, caption="one")
        Post.objects.create(author=user, caption="two", deleted_at=post.created_at)

        tasks.reconcile()

        # Soft-deleted posts are not posts. Counting them is how a profile
        # ends up claiming content that no read path will return.
        assert stored("user", user.pk, "posts") == 1

    def test_it_advances_and_then_wraps(self, user: User, other_user: User) -> None:
        """The cursor is what makes a slice a sweep rather than the same slice."""
        first = tasks.reconcile(batch_size=1)
        assert first["users"] == 1

        second = tasks.reconcile(batch_size=1)
        assert second["users"] == 1

        # Two users, so the third run finds nothing and resets to the start.
        third = tasks.reconcile(batch_size=1)
        assert third["users"] == 0
        assert cache.get("counters:reconcile:cursor:user") == 0

        fourth = tasks.reconcile(batch_size=1)
        assert fourth["users"] == 1

    def test_a_run_that_repairs_nothing_still_reports_what_it_touched(
        self, user: User
    ) -> None:
        # So a scheduled task that is silently doing nothing is visible in a
        # log as distinct from one that is finding nothing wrong.
        assert tasks.reconcile()["users"] == 1


class TestRecountCommand:
    def test_it_repairs_one_account(self, user: User, other_user: User) -> None:
        follow(other_user, user)

        call_command("recount", user=user.username)

        assert stored("user", user.pk, "followers") == 1

    def test_it_repairs_one_post(self, user: User, other_user: User) -> None:
        from posts.models import Like

        post = Post.objects.create(author=user, caption="something")
        Like.objects.create(post=post, user=other_user)

        call_command("recount", post=post.pk)

        assert stored("post", post.pk, "likes") == 1

    def test_it_repairs_everything(self, user: User, other_user: User) -> None:
        follow(other_user, user)
        Post.objects.create(author=user, caption="something")

        call_command("recount", all=True)

        assert stored("user", user.pk, "followers") == 1
        assert stored("user", user.pk, "posts") == 1

    def test_it_refuses_to_run_with_no_target(self) -> None:
        # `recount` with no arguments recounting everything would be a very
        # expensive typo.
        with pytest.raises(CommandError):
            call_command("recount")

    def test_it_says_so_when_the_account_does_not_exist(self) -> None:
        with pytest.raises(CommandError):
            call_command("recount", user="nobody")
