"""Tests for setting an avatar.

The checks here are the reason this is a service rather than a serializer
field: an avatar is a reference to a media row somebody else may own, and
`PATCH {"avatar_media_id": "..."}` with a guessed id is impersonation that
needs no upload at all.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from media.models import Media
from users import services
from users.models import User

pytestmark = pytest.mark.django_db


def media_for(
    owner: User, *, state: str = Media.State.READY, kind: str = "image"
) -> Media:
    return Media.objects.create(
        owner=owner,
        kind=kind,
        declared_mime="image/jpeg",
        declared_size_bytes=1000,
        bucket="media",
        state=state,
    )


class TestSettingAnAvatar:
    def test_your_own_ready_image_is_accepted(self, user: User) -> None:
        image = media_for(user)

        services.update_profile(user=user, avatar_media_id=str(image.pk))

        user.refresh_from_db()
        assert user.avatar_media_id == image.pk

    def test_somebody_else_s_image_is_refused(
        self, user: User, other_user: User
    ) -> None:
        # The whole point. Without this check an avatar is a way to wear
        # someone else's photograph by guessing an id.
        theirs = media_for(other_user)

        with pytest.raises(services.ProfileRejectedError):
            services.update_profile(user=user, avatar_media_id=str(theirs.pk))

    def test_an_unprocessed_image_is_refused(self, user: User) -> None:
        # The URL points at a derivative the worker writes. Accepting a
        # pending row means every surface renders a broken image.
        pending = media_for(user, state=Media.State.PENDING)

        with pytest.raises(services.ProfileRejectedError):
            services.update_profile(user=user, avatar_media_id=str(pending.pk))

    def test_a_video_is_refused(self, user: User) -> None:
        clip = media_for(user, kind="video")

        with pytest.raises(services.ProfileRejectedError):
            services.update_profile(user=user, avatar_media_id=str(clip.pk))

    def test_nonsense_is_refused_rather_than_raising(self, user: User) -> None:
        with pytest.raises(services.ProfileRejectedError):
            services.update_profile(user=user, avatar_media_id="not-a-number")

    def test_an_empty_string_clears_it(self, user: User) -> None:
        image = media_for(user)
        services.update_profile(user=user, avatar_media_id=str(image.pk))

        services.update_profile(user=user, avatar_media_id="")

        user.refresh_from_db()
        assert user.avatar_media_id is None

    def test_omitting_it_leaves_it_alone(self, user: User) -> None:
        # A PATCH that does not mention the avatar must not remove it, which
        # is why `None` and `""` mean different things here.
        image = media_for(user)
        services.update_profile(user=user, avatar_media_id=str(image.pk))

        services.update_profile(user=user, bio="Changed something else.")

        user.refresh_from_db()
        assert user.avatar_media_id == image.pk


class TestTheAvatarUrl:
    def test_it_is_null_without_an_avatar(self, signed_in: APIClient) -> None:
        response = signed_in.get("/api/users/me")
        assert response.json()["avatar_url"] is None

    def test_it_is_a_url_once_set(self, signed_in: APIClient, user: User) -> None:
        image = media_for(user)
        services.update_profile(user=user, avatar_media_id=str(image.pk))

        payload = signed_in.get("/api/users/me").json()

        # The id alone was what the API used to return, and no client could
        # turn it into a picture — every avatar rendered as initials.
        assert payload["avatar_media_id"] == str(image.pk)
        assert payload["avatar_url"] is not None
        assert str(image.pk) in payload["avatar_url"]

    def test_a_profile_is_refused_by_the_api_rather_than_500(
        self, signed_in: APIClient, other_user: User
    ) -> None:
        theirs = media_for(other_user)

        response = signed_in.patch(
            "/api/users/me", {"avatar_media_id": str(theirs.pk)}, format="json"
        )

        assert response.status_code == 400
        assert "not yours" in response.json()["detail"]


class TestProfileAndRequestPayloads:
    """The nested-serializer paths, which are the ones that broke.

    `ProfileSerializer.user` and `FollowRequestSerializer.follower` are both
    `UserSerializer`, and both views used to hand them
    `UserSerializer(x).data` — serialising the same user twice. That was
    invisible while every field was a plain column and became a 500 the
    moment one of them read a model attribute. A test on `/api/users/me`
    would not have caught it, because `me` has no nesting.
    """

    def test_a_profile_carries_the_avatar(
        self, signed_in: APIClient, user: User
    ) -> None:
        image = media_for(user)
        services.update_profile(user=user, avatar_media_id=str(image.pk))

        response = signed_in.get(f"/api/users/{user.username}")

        assert response.status_code == 200
        assert response.json()["user"]["avatar_url"] is not None

    def test_a_follow_request_carries_the_avatar(
        self, signed_in: APIClient, user: User, other_user: User
    ) -> None:
        from users.models import Follow

        image = media_for(other_user)
        services.update_profile(user=other_user, avatar_media_id=str(image.pk))
        user.is_private = True
        user.save(update_fields=["is_private"])
        Follow.objects.create(
            follower=other_user, followee=user, status=Follow.Status.PENDING
        )

        response = signed_in.get("/api/users/requests")

        assert response.status_code == 200
        assert response.json()[0]["follower"]["avatar_url"] is not None
