"""Tests for `posts.selectors` — mostly, tests that blocking works.

`01-ARCHITECTURE.md` §11 says block enforcement is non-negotiable from Phase 3
onward and that it will be checked. This file is the check: every read path
that returns user content, asserted to drop a blocked account in **both**
directions.
"""

from __future__ import annotations

import pytest

from posts import selectors, services
from posts.models import Post
from users import selectors as user_selectors
from users import services as user_services
from users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def author(db: object) -> User:
    return User.objects.create_user(
        email="author@example.com", username="author", password="correct-horse-staple"
    )


def _post(author: User, caption: str = "hello") -> Post:
    return Post.objects.create(author=author, caption=caption)


def _follow(follower: User, followee: User) -> None:
    user_services.follow(follower=follower, followee=followee)


class TestFeed:
    def test_shows_posts_from_accounts_you_follow(
        self, user: User, author: User
    ) -> None:
        _follow(user, author)
        post = _post(author)
        assert list(selectors.feed(viewer=user)) == [post]

    def test_hides_posts_from_accounts_you_do_not_follow(
        self, user: User, author: User
    ) -> None:
        _post(author)
        assert list(selectors.feed(viewer=user)) == []

    def test_hides_a_pending_follow(self, user: User, author: User) -> None:
        """A request is not a follow. `status='accepted'` is doing real work."""
        author.is_private = True
        author.save(update_fields=["is_private"])
        _follow(user, author)
        _post(author)
        assert list(selectors.feed(viewer=user)) == []

    def test_hides_soft_deleted_posts(self, user: User, author: User) -> None:
        _follow(user, author)
        post = _post(author)
        services.soft_delete_post(post=post)
        assert list(selectors.feed(viewer=user)) == []

    def test_orders_newest_first_and_paginates_by_cursor(
        self, user: User, author: User
    ) -> None:
        _follow(user, author)
        first = _post(author, "first")
        second = _post(author, "second")
        third = _post(author, "third")

        page = list(selectors.feed(viewer=user, limit=2))
        assert page == [third, second]

        # Snowflakes are time-ordered, so the cursor is simply "older than".
        rest = list(selectors.feed(viewer=user, cursor=page[-1].pk, limit=2))
        assert rest == [first]


class TestBlockingRemovesThemEverywhere:
    """Rule 8, in both directions, on every read path that returns content."""

    def test_blocking_removes_them_from_your_feed(
        self, user: User, author: User
    ) -> None:
        _follow(user, author)
        _post(author)
        assert len(list(selectors.feed(viewer=user))) == 1

        user_services.block(blocker=user, blocked=author)
        assert list(selectors.feed(viewer=user)) == []

    def test_being_blocked_removes_them_from_your_feed_too(
        self, user: User, author: User
    ) -> None:
        """The blocked account must not be able to keep watching."""
        _follow(user, author)
        _post(author)

        # `author` blocks `user`; it is `user`'s feed that must go empty.
        user_services.block(blocker=author, blocked=user)
        assert list(selectors.feed(viewer=user)) == []

    def test_blocking_severs_the_follow(self, user: User, author: User) -> None:
        _follow(user, author)
        user_services.block(blocker=user, blocked=author)
        assert user_selectors.follow_between(follower=user, followee=author) is None

    def test_blocking_removes_them_from_search(self, user: User, author: User) -> None:
        assert list(user_selectors.search(viewer=user, query="author")) == [author]
        user_services.block(blocker=user, blocked=author)
        assert list(user_selectors.search(viewer=user, query="author")) == []

    def test_being_blocked_removes_them_from_search(
        self, user: User, author: User
    ) -> None:
        user_services.block(blocker=author, blocked=user)
        assert list(user_selectors.search(viewer=user, query="author")) == []

    def test_blocking_removes_their_comments(self, user: User, author: User) -> None:
        post = _post(user)
        services.add_comment(author=author, post=post, body="nice")
        assert len(list(selectors.comments_for(viewer=user, post=post))) == 1

        user_services.block(blocker=user, blocked=author)
        assert list(selectors.comments_for(viewer=user, post=post)) == []

    def test_blocking_removes_their_profile(self, user: User, author: User) -> None:
        assert (
            user_selectors.visible_profile(viewer=user, username="author") is not None
        )
        user_services.block(blocker=user, blocked=author)
        assert user_selectors.visible_profile(viewer=user, username="author") is None

    def test_blocking_removes_their_posts_from_the_contact_sheet(
        self, user: User, author: User
    ) -> None:
        _post(author)
        assert len(list(selectors.by_author(viewer=user, author=author))) == 1
        user_services.block(blocker=user, blocked=author)
        assert list(selectors.by_author(viewer=user, author=author)) == []

    def test_blocking_removes_a_single_post_by_id(
        self, user: User, author: User
    ) -> None:
        post = _post(author)
        assert selectors.visible_post(viewer=user, post_id=post.pk) is not None
        user_services.block(blocker=user, blocked=author)
        assert selectors.visible_post(viewer=user, post_id=post.pk) is None

    def test_unblocking_does_not_restore_the_follow(
        self, user: User, author: User
    ) -> None:
        """Restoring it would silently re-expose content they cut off."""
        _follow(user, author)
        user_services.block(blocker=user, blocked=author)
        user_services.unblock(blocker=user, blocked=author)
        assert user_selectors.follow_between(follower=user, followee=author) is None


class TestPrivateAccounts:
    def test_a_stranger_cannot_view_a_private_accounts_posts(
        self, user: User, author: User
    ) -> None:
        author.is_private = True
        author.save(update_fields=["is_private"])
        assert not user_selectors.can_view_posts(viewer=user, author=author)

    def test_an_accepted_follower_can(self, user: User, author: User) -> None:
        author.is_private = True
        author.save(update_fields=["is_private"])
        _follow(user, author)
        user_services.respond_to_request(followee=author, follower=user, accept=True)
        assert user_selectors.can_view_posts(viewer=user, author=author)

    def test_the_account_itself_always_can(self, author: User) -> None:
        author.is_private = True
        author.save(update_fields=["is_private"])
        assert user_selectors.can_view_posts(viewer=author, author=author)
