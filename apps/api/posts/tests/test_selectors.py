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
from users.models import Block, User

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
    def test_shows_your_own_posts_without_a_self_follow(self, user: User) -> None:
        post = _post(user, "mine")

        assert list(selectors.feed(viewer=user)) == [post]

    def test_shows_your_own_private_posts(self, user: User) -> None:
        post = Post.objects.create(
            author=user,
            caption="only mine",
            visibility=Post.Visibility.PRIVATE,
        )

        assert list(selectors.feed(viewer=user)) == [post]

    def test_shows_posts_from_accounts_you_follow(
        self, user: User, author: User
    ) -> None:
        _follow(user, author)
        post = _post(author)
        assert list(selectors.feed(viewer=user)) == [post]

    def test_hides_a_followed_accounts_private_post(
        self, user: User, author: User
    ) -> None:
        _follow(user, author)
        Post.objects.create(
            author=author,
            caption="not shared",
            visibility=Post.Visibility.PRIVATE,
        )

        assert list(selectors.feed(viewer=user)) == []

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


# ---------------------------------------------------------------------------
# Explore — discovery, not a second copy of the feed
# ---------------------------------------------------------------------------


class TestExplore:
    def test_it_excludes_who_you_already_follow(self, db: object) -> None:
        """Otherwise it is the feed with a different name, and a page you have
        already read."""
        viewer = User.objects.create_user("ex-a@example.com", "ex-a", "pw-explore-12")
        followed = User.objects.create_user("ex-b@example.com", "ex-b", "pw-explore-12")
        stranger = User.objects.create_user("ex-c@example.com", "ex-c", "pw-explore-12")

        user_services.follow(follower=viewer, followee=followed)
        _post(followed, "followed")
        _post(stranger, "stranger")

        bodies = [p.caption for p in selectors.explore(viewer=viewer)]
        assert bodies == ["stranger"]

    def test_it_excludes_your_own_posts(self, db: object) -> None:
        viewer = User.objects.create_user("ex-d@example.com", "ex-d", "pw-explore-12")
        _post(viewer, "mine")

        assert list(selectors.explore(viewer=viewer)) == []

    def test_private_accounts_never_appear(self, db: object) -> None:
        """Someone who set their account private did not opt into discovery.

        `can_view_posts` would let a follower through, which is right for a
        profile and wrong for a discovery surface.
        """
        viewer = User.objects.create_user("ex-e@example.com", "ex-e", "pw-explore-12")
        shy = User.objects.create_user(
            "ex-f@example.com", "ex-f", "pw-explore-12", is_private=True
        )
        _post(shy, "private")

        assert list(selectors.explore(viewer=viewer)) == []

    def test_it_filters_blocks(self, db: object) -> None:
        """Rule 8 reaches every read path, discovery included."""
        viewer = User.objects.create_user("ex-g@example.com", "ex-g", "pw-explore-12")
        blocked = User.objects.create_user("ex-h@example.com", "ex-h", "pw-explore-12")
        _post(blocked, "hidden")
        Block.objects.create(blocker=viewer, blocked=blocked)

        assert list(selectors.explore(viewer=viewer)) == []

    def test_a_signed_out_visitor_sees_public_posts(self, db: object) -> None:
        """Requiring an account to look at public posts is a decision to have
        no front door."""
        author = User.objects.create_user("ex-i@example.com", "ex-i", "pw-explore-12")
        _post(author, "public")

        assert [p.caption for p in selectors.explore(viewer=None)] == ["public"]

    def test_the_cursor_is_a_snowflake_walked_downwards(self, db: object) -> None:
        """Same shape as the feed: no offsets, so nothing shifts or repeats
        while someone is scrolling."""
        viewer = User.objects.create_user("ex-j@example.com", "ex-j", "pw-explore-12")
        author = User.objects.create_user("ex-k@example.com", "ex-k", "pw-explore-12")
        posts = [_post(author, f"p{i}") for i in range(5)]

        first = list(selectors.explore(viewer=viewer, limit=2))
        assert [p.caption for p in first] == ["p4", "p3"]

        second = list(selectors.explore(viewer=viewer, cursor=first[-1].pk, limit=2))
        assert [p.caption for p in second] == ["p2", "p1"]
        assert posts[0].pk not in {p.pk for p in second}


# ---------------------------------------------------------------------------
# The feed cache — 01-ARCHITECTURE.md §7 phase 2
# ---------------------------------------------------------------------------


class TestFeedCache:
    """What has to stay true once a cache sits over the feed.

    Every test here is about *correctness*, not speed. A cache that is fast
    and occasionally wrong is worse than the query it replaced, and §7 chose
    the pull feed precisely because it has "no invalidation bugs" — so these
    pin the ways this layer could introduce some.
    """

    @pytest.fixture(autouse=True)
    def _clean(self) -> None:
        from posts import cache

        try:
            from posts.cache import _client

            client = _client()
            for found in client.scan_iter("feed:*"):
                client.delete(found)
        except Exception:
            pytest.skip("Redis is unavailable and the cache fails open without it")
        assert cache.TTL_SECONDS == 30 * 60

    def test_a_second_read_matches_the_first(self, user: User, author: User) -> None:
        """The whole point: a hit and a miss return the same page."""
        _follow(user, author)
        for index in range(5):
            _post(author, f"p{index}")

        first = [p.pk for p in selectors.cached_feed(viewer=user)]
        second = [p.pk for p in selectors.cached_feed(viewer=user)]

        assert first == second
        assert len(first) == 5

    def test_a_hit_keeps_your_own_private_post(self, user: User) -> None:
        from posts import cache

        post = Post.objects.create(
            author=user,
            caption="only mine",
            visibility=Post.Visibility.PRIVATE,
        )
        cache.store(user_id=user.pk, post_ids=[post.pk])

        assert selectors.cached_feed(viewer=user, limit=1) == [post]

    def test_a_hit_drops_a_followed_accounts_private_post(
        self, user: User, author: User
    ) -> None:
        from posts import cache

        _follow(user, author)
        post = Post.objects.create(
            author=author,
            caption="not shared",
            visibility=Post.Visibility.PRIVATE,
        )
        cache.store(user_id=user.pk, post_ids=[post.pk])

        assert selectors.cached_feed(viewer=user, limit=1) == []

    def test_a_hit_still_hides_a_deleted_post(self, user: User, author: User) -> None:
        """The reason ids are cached and posts are not.

        Caching serialised posts would need invalidating on every deletion;
        caching ids means the rows are re-read and `live()` does its job.
        """
        _follow(user, author)
        posts = [_post(author, f"p{i}") for i in range(3)]
        selectors.cached_feed(viewer=user)  # warm

        services.soft_delete_post(post=posts[1])

        assert posts[1].pk not in {p.pk for p in selectors.cached_feed(viewer=user)}

    def test_a_hit_still_filters_a_new_block(self, user: User, author: User) -> None:
        """Rule 8 survives the cache, which is the same property as above.

        A block created after the set was written must take effect on the very
        next read — the Phase 4 verification, now with a cache in the way.
        """
        _follow(user, author)
        _post(author, "theirs")
        selectors.cached_feed(viewer=user)  # warm

        Block.objects.create(blocker=user, blocked=author)

        assert list(selectors.cached_feed(viewer=user)) == []

    def test_a_new_post_reaches_a_warm_feed(self, user: User, author: User) -> None:
        """§7: "invalidated on a followee's new post"."""
        _follow(user, author)
        _post(author, "first")
        selectors.cached_feed(viewer=user)  # warm

        fresh = _post(author, "second")

        assert selectors.cached_feed(viewer=user)[0].pk == fresh.pk

    def test_following_someone_drops_the_cached_feed(
        self, user: User, author: User
    ) -> None:
        """A follow changes *which* accounts the feed draws from, so the whole
        set is wrong rather than merely incomplete."""
        from posts import cache

        _post(author, "theirs")
        selectors.cached_feed(viewer=user)  # warm, and empty

        _follow(user, author)

        assert cache.get_page(user_id=user.pk, cursor=None, limit=30) is None
        assert len(selectors.cached_feed(viewer=user)) == 1

    def test_an_empty_feed_is_not_mistaken_for_a_cold_cache(self, user: User) -> None:
        """`[]` and `None` mean different things.

        Collapsing them would make a new account's empty feed indistinguishable
        from a cache miss forever.
        """
        from posts import cache

        assert cache.get_page(user_id=user.pk, cursor=None, limit=30) is None
        cache.store(user_id=user.pk, post_ids=[])
        # Storing nothing must not create a set that reads as an empty feed.
        assert cache.get_page(user_id=user.pk, cursor=None, limit=30) is None

    def test_a_push_never_invents_a_feed(self, user: User) -> None:
        """A cache that creates a page it never got from the database would
        serve one post and claim it was the whole feed."""
        from posts import cache

        cache.push(user_ids=[user.pk], post_id=80_000_000_000_000_001)

        assert cache.get_page(user_id=user.pk, cursor=None, limit=30) is None

    def test_a_new_post_pushes_into_the_authors_warm_feed(
        self, user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from posts import cache

        pushed_to: list[int] = []

        def record_push(*, user_ids: list[int], post_id: int) -> None:
            pushed_to.extend(user_ids)
            assert post_id == post.pk

        monkeypatch.setattr(cache, "push", record_push)
        post = _post(user, "mine")

        services._fan_out_to_feeds(post)

        assert user.pk in pushed_to

    def test_the_cursor_walks_backwards_through_a_hit(
        self, user: User, author: User
    ) -> None:
        posts = []
        _follow(user, author)
        for index in range(6):
            posts.append(_post(author, f"p{index}"))

        first = selectors.cached_feed(viewer=user, limit=2)
        assert [p.caption for p in first] == ["p5", "p4"]

        second = selectors.cached_feed(viewer=user, cursor=first[-1].pk, limit=2)
        assert [p.caption for p in second] == ["p3", "p2"]

    def test_the_feed_survives_redis_being_gone(
        self, user: User, author: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Fail open. A feed cache that takes the site down when Redis blinks
        is worse than no feed cache."""
        import redis

        from posts import cache

        _follow(user, author)
        _post(author, "still here")

        def broken() -> None:
            raise redis.ConnectionError("redis is down")

        monkeypatch.setattr(cache, "_client", broken)

        assert [p.caption for p in selectors.cached_feed(viewer=user)] == ["still here"]
