"""Reposts.

The two properties worth pinning are the ones that would rot quietly: that a
repost of a repost points at the root rather than growing a chain, and that
the count on the original is the count of people who reposted it rather than
the length of whatever chain happened to form.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest

from counters.models import Counter
from counters.selectors import get_many
from notifications.models import Notification
from posts import selectors, services
from posts.models import Post
from users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def post(user: User) -> Post:
    return Post.objects.create(author=user, caption="a photograph")


@pytest.fixture
def third(db: object) -> User:
    return User.objects.create_user(
        email="lin@example.com", username="lin", password="correct-horse-staple"
    )


@pytest.fixture(autouse=True)
def _counters_apply(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run counter moves in-process instead of posting them to a broker.

    `_bump` schedules `adjust.delay` after commit, so without this the counts
    these tests are about are decided by a worker that is not running. Applying
    the same increment synchronously keeps the arithmetic under test and leaves
    the queueing to the queue's own tests.
    """
    from counters import services as counter_services
    from counters.tasks import adjust

    def apply(entity_type: str, entity_id: int, metric: str, delta: int = 1) -> None:
        counter_services.increment(
            entity_type=entity_type,
            entity_id=entity_id,
            metric=metric,
            delta=delta,
        )

    monkeypatch.setattr(adjust, "delay", apply)
    yield


@pytest.fixture
def committed(
    django_capture_on_commit_callbacks: Any,
) -> Callable[[Callable[[], Any]], Any]:
    """Run something and then fire what it queued for after the commit."""

    def run(action: Callable[[], Any]) -> Any:
        with django_capture_on_commit_callbacks(execute=True):
            return action()

    return run


def repost_count(post: Post) -> int:
    return get_many(
        entity_type=Counter.EntityType.POST,
        entity_ids=[post.pk],
        metric=Counter.Metric.REPOSTS,
    ).get(post.pk, 0)


class TestRepost:
    def test_creates_a_post_pointing_at_the_original(
        self, user: User, other_user: User, post: Post, committed: Any
    ) -> None:
        made = committed(lambda: services.repost(user=other_user, post=post))
        assert made.reposted_from_id == post.pk
        assert made.author_id == other_user.pk
        assert repost_count(post) == 1

    def test_is_idempotent(
        self, user: User, other_user: User, post: Post, committed: Any
    ) -> None:
        first = committed(lambda: services.repost(user=other_user, post=post))
        second = committed(lambda: services.repost(user=other_user, post=post))
        assert first.pk == second.pk
        assert repost_count(post) == 1

    def test_a_chain_flattens_to_the_root(
        self,
        user: User,
        other_user: User,
        third: User,
        post: Post,
        committed: Any,
    ) -> None:
        once = committed(lambda: services.repost(user=other_user, post=post))
        twice = committed(lambda: services.repost(user=third, post=once))
        assert twice.reposted_from_id == post.pk
        # Two people reposted the photograph, so the photograph says two.
        assert repost_count(post) == 2
        assert repost_count(once) == 0

    def test_refuses_your_own(self, user: User, post: Post) -> None:
        with pytest.raises(services.PostRejectedError):
            services.repost(user=user, post=post)

    def test_notifies_the_author_and_withdraws_on_undo(
        self, user: User, other_user: User, post: Post, committed: Any
    ) -> None:
        committed(lambda: services.repost(user=other_user, post=post))
        assert Notification.objects.filter(verb=Notification.Verb.REPOST).count() == 1

        assert committed(lambda: services.undo_repost(user=other_user, post=post))
        assert Notification.objects.filter(verb=Notification.Verb.REPOST).count() == 0
        assert repost_count(post) == 0

    def test_undo_is_idempotent(self, user: User, other_user: User, post: Post) -> None:
        assert services.undo_repost(user=other_user, post=post) is False

    def test_undoing_through_the_repost_finds_it(
        self, user: User, other_user: User, post: Post
    ) -> None:
        """The UI may hold either the original or the repost. Both work."""
        made = services.repost(user=other_user, post=post)
        assert services.undo_repost(user=other_user, post=made) is True

    def test_viewer_state_is_one_query_for_the_page(
        self, user: User, other_user: User, post: Post
    ) -> None:
        services.repost(user=other_user, post=post)
        assert selectors.reposted_post_ids(viewer=other_user, post_ids=[post.pk]) == {
            post.pk
        }
        assert selectors.reposted_post_ids(viewer=user, post_ids=[post.pk]) == set()
