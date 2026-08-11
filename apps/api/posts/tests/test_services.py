"""Tests for `posts.services` and the follow/block services."""

from __future__ import annotations

from typing import Any

import pytest

from media.models import Media
from posts import services
from posts.models import Comment, Like, Post
from users import services as user_services
from users.models import Follow, User

pytestmark = pytest.mark.django_db


@pytest.fixture
def ready_media(user: User) -> Media:
    return Media.objects.create(
        owner=user,
        kind=Media.Kind.IMAGE,
        declared_mime="image/jpeg",
        declared_size_bytes=1000,
        bucket="media",
        object_key="x/1/original.jpg",
        state=Media.State.READY,
        width=1080,
        height=1350,
    )


class TestCreatePost:
    def test_publishes_from_ready_media(self, user: User, ready_media: Media) -> None:
        post = services.create_post(author=user, media_ids=[ready_media.pk])
        assert post.attachments.count() == 1

    def test_refuses_media_that_is_still_processing(self, user: User) -> None:
        pending = Media.objects.create(
            owner=user,
            kind=Media.Kind.IMAGE,
            declared_mime="image/jpeg",
            declared_size_bytes=1,
            bucket="media",
            object_key="x/2/original.jpg",
            state=Media.State.PENDING,
        )
        with pytest.raises(services.PostRejectedError):
            services.create_post(author=user, media_ids=[pending.pk])

    def test_refuses_someone_elses_media(
        self, user: User, other_user: User, ready_media: Media
    ) -> None:
        """Otherwise a stranger's photograph is one guessed id away."""
        with pytest.raises(services.PostRejectedError):
            services.create_post(author=other_user, media_ids=[ready_media.pk])

    def test_refuses_an_empty_post(self, user: User) -> None:
        with pytest.raises(services.PostRejectedError):
            services.create_post(author=user, media_ids=[])

    def test_preserves_the_order_the_client_sent(
        self, user: User, ready_media: Media
    ) -> None:
        second = Media.objects.create(
            owner=user,
            kind=Media.Kind.IMAGE,
            declared_mime="image/jpeg",
            declared_size_bytes=1,
            bucket="media",
            object_key="x/3/original.jpg",
            state=Media.State.READY,
        )
        post = services.create_post(author=user, media_ids=[second.pk, ready_media.pk])
        positions = list(
            post.attachments.order_by("position").values_list("media_id", flat=True)
        )
        assert positions == [second.pk, ready_media.pk]


class TestLikes:
    def test_liking_twice_is_one_like(self, user: User, other_user: User) -> None:
        post = Post.objects.create(author=other_user)
        assert services.like(user=user, post=post) is True
        assert services.like(user=user, post=post) is False
        assert Like.objects.filter(post=post).count() == 1

    def test_unliking_is_idempotent(self, user: User, other_user: User) -> None:
        post = Post.objects.create(author=other_user)
        services.like(user=user, post=post)
        assert services.unlike(user=user, post=post) is True
        assert services.unlike(user=user, post=post) is False


class TestComments:
    def test_rejects_an_empty_comment(self, user: User, other_user: User) -> None:
        post = Post.objects.create(author=other_user)
        with pytest.raises(services.PostRejectedError):
            services.add_comment(author=user, post=post, body="   ")

    def test_replies_never_nest_more_than_one_level(
        self, user: User, other_user: User
    ) -> None:
        """Threads deeper than one are unreadable in a 640px column."""
        post = Post.objects.create(author=other_user)
        top = services.add_comment(author=user, post=post, body="top")
        reply = services.add_comment(author=user, post=post, body="reply", parent=top)
        deeper = services.add_comment(
            author=user, post=post, body="deeper", parent=reply
        )
        assert deeper.parent_id == top.pk

    def test_soft_delete_leaves_the_row(self, user: User, other_user: User) -> None:
        post = Post.objects.create(author=other_user)
        comment = services.add_comment(author=user, post=post, body="hi")
        services.soft_delete_comment(comment=comment)
        assert Comment.objects.filter(pk=comment.pk).exists()


class TestFollows:
    def test_following_a_public_account_is_immediate(
        self, user: User, other_user: User
    ) -> None:
        edge = user_services.follow(follower=user, followee=other_user)
        assert edge.status == Follow.Status.ACCEPTED

    def test_following_a_private_account_is_a_request(
        self, user: User, other_user: User
    ) -> None:
        other_user.is_private = True
        other_user.save(update_fields=["is_private"])
        edge = user_services.follow(follower=user, followee=other_user)
        assert edge.status == Follow.Status.PENDING

    def test_following_twice_is_idempotent(self, user: User, other_user: User) -> None:
        first = user_services.follow(follower=user, followee=other_user)
        second = user_services.follow(follower=user, followee=other_user)
        assert first.pk == second.pk

    def test_you_cannot_follow_yourself(self, user: User) -> None:
        with pytest.raises(user_services.NotAllowedError):
            user_services.follow(follower=user, followee=user)

    def test_you_cannot_follow_someone_you_have_blocked(
        self, user: User, other_user: User
    ) -> None:
        user_services.block(blocker=user, blocked=other_user)
        with pytest.raises(user_services.NotAllowedError):
            user_services.follow(follower=user, followee=other_user)

    def test_declining_a_request_removes_it(self, user: User, other_user: User) -> None:
        other_user.is_private = True
        other_user.save(update_fields=["is_private"])
        user_services.follow(follower=user, followee=other_user)
        user_services.respond_to_request(
            followee=other_user, follower=user, accept=False
        )
        assert not Follow.objects.filter(follower=user, followee=other_user).exists()

    def test_only_the_followee_may_respond(
        self, user: User, other_user: User, fake_storage: dict[str, Any]
    ) -> None:
        other_user.is_private = True
        other_user.save(update_fields=["is_private"])
        user_services.follow(follower=user, followee=other_user)
        # `user` trying to approve their own request finds no pending edge
        # addressed to them.
        with pytest.raises(user_services.NotAllowedError):
            user_services.respond_to_request(
                followee=user, follower=other_user, accept=True
            )
