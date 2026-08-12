"""Tests for the notifications app and the services that raise notifications.

The interesting cases are all about *absence*: the row that must not be
written for your own action, the second row a double tap must not produce, and
the row that must disappear when the thing it announced is undone. A
notification list is a place where duplicates and ghosts are noticed
immediately, and none of those three are visible from the happy path.
"""

from __future__ import annotations

import pytest

from notifications import selectors, services
from notifications.models import Notification
from posts import services as post_services
from posts.models import Post
from users import services as user_services
from users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def post(user: User) -> Post:
    return Post.objects.create(author=user, caption="a photograph")


class TestNotify:
    def test_writes_a_row(self, user: User, other_user: User, post: Post) -> None:
        made = services.notify(
            recipient=user,
            actor=other_user,
            verb=Notification.Verb.LIKE,
            post=post,
        )
        assert made is not None
        assert Notification.objects.count() == 1

    def test_stays_silent_about_your_own_action(self, user: User, post: Post) -> None:
        assert (
            services.notify(
                recipient=user,
                actor=user,
                verb=Notification.Verb.LIKE,
                post=post,
            )
            is None
        )
        assert Notification.objects.count() == 0

    def test_the_same_news_twice_is_one_row(
        self, user: User, other_user: User, post: Post
    ) -> None:
        services.notify(
            recipient=user, actor=other_user, verb=Notification.Verb.LIKE, post=post
        )
        services.notify(
            recipient=user, actor=other_user, verb=Notification.Verb.LIKE, post=post
        )
        assert Notification.objects.count() == 1

    def test_comments_are_not_deduped(
        self, user: User, other_user: User, post: Post
    ) -> None:
        """Two likes are one fact. Two comments are two."""
        first = post_services.add_comment(author=other_user, post=post, body="one")
        second = post_services.add_comment(author=other_user, post=post, body="two")
        assert first.pk != second.pk
        assert Notification.objects.filter(verb=Notification.Verb.COMMENT).count() == 2


class TestLikeNotifications:
    def test_like_notifies_and_unlike_withdraws(
        self, user: User, other_user: User, post: Post
    ) -> None:
        post_services.like(user=other_user, post=post)
        assert Notification.objects.filter(verb=Notification.Verb.LIKE).count() == 1

        post_services.unlike(user=other_user, post=post)
        assert Notification.objects.filter(verb=Notification.Verb.LIKE).count() == 0

    def test_liking_your_own_post_notifies_nobody(self, user: User, post: Post) -> None:
        post_services.like(user=user, post=post)
        assert Notification.objects.count() == 0


class TestFollowNotifications:
    def test_a_public_follow_is_a_follow(self, user: User, other_user: User) -> None:
        user_services.follow(follower=other_user, followee=user)
        assert Notification.objects.get().verb == Notification.Verb.FOLLOW

    def test_a_private_follow_is_a_request(self, user: User, other_user: User) -> None:
        user.is_private = True
        user.save(update_fields=["is_private"])
        user_services.follow(follower=other_user, followee=user)
        assert Notification.objects.get().verb == Notification.Verb.FOLLOW_REQUEST


class TestSelectors:
    def test_blocked_actors_are_filtered_out(
        self, user: User, other_user: User, post: Post
    ) -> None:
        """Rule 8. A block should empty out what that person already sent."""
        post_services.like(user=other_user, post=post)
        assert selectors.unread_count(user) == 1

        user_services.block(blocker=user, blocked=other_user)
        assert selectors.unread_count(user) == 0
        assert list(selectors.page(user=user)) == []

    def test_mark_all_read_clears_the_count(
        self, user: User, other_user: User, post: Post
    ) -> None:
        post_services.like(user=other_user, post=post)
        assert services.mark_all_read(user=user) == 1
        assert selectors.unread_count(user) == 0
        # And is idempotent — a second call has nothing left to do.
        assert services.mark_all_read(user=user) == 0
