"""DRF shapes for the users app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.

These feed drf-spectacular, which generates `packages/api-client`. A change
here is a change to the frontend's types -- regenerate in the same commit.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from config.fields import SnowflakeField
from users.models import User


class UserSerializer(serializers.ModelSerializer[User]):
    """A user as anyone may see them. No email, no permission flags."""

    id = SnowflakeField(read_only=True)
    avatar_media_id = SnowflakeField(read_only=True, allow_null=True)

    class Meta:
        model = User
        # Annotated so CurrentUserSerializer may add to it: without this the
        # inferred type is a fixed-length tuple and the subclass "changes" it.
        fields: tuple[str, ...] = (
            "id",
            "username",
            "display_name",
            "avatar_media_id",
            "bio",
            "is_private",
            "created_at",
        )
        read_only_fields: tuple[str, ...] = fields


class CurrentUserSerializer(UserSerializer):
    """The signed-in user seeing their own account. Adds the private bits."""

    class Meta(UserSerializer.Meta):
        fields = (*UserSerializer.Meta.fields, "email")
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer[dict[str, Any]]):
    """What it takes to open an account.

    `username` is constrained here rather than only at the database, because
    the model's uniqueness will not tell you that a space is not allowed. The
    pattern matches what a profile URL can carry — `/u/<username>` — so a name
    that cannot be linked to cannot be chosen.
    """

    email = serializers.EmailField()
    username = serializers.RegexField(
        r"^[A-Za-z0-9_.]+$",
        min_length=3,
        max_length=30,
        error_messages={
            "invalid": "Usernames use letters, numbers, underscores and dots."
        },
    )
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    """Credentials. Email is the login identifier here, not username."""

    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})


class ProfileSerializer(serializers.Serializer[dict[str, Any]]):
    """A profile header.

    Counts come from the `counters` app, never from a `COUNT(*)` — a follower
    count on a popular account is a sequential scan over millions of rows, and
    it renders on every profile view.

    `follow_state` is what the button reads: absent, `pending` while a private
    account considers the request, or `accepted`.
    """

    user = UserSerializer(read_only=True)
    post_count = serializers.IntegerField(read_only=True)
    follower_count = serializers.IntegerField(read_only=True)
    following_count = serializers.IntegerField(read_only=True)
    follow_state = serializers.ChoiceField(
        choices=["none", "pending", "accepted"], read_only=True
    )
    is_self = serializers.BooleanField(read_only=True)
    can_view_posts = serializers.BooleanField(read_only=True)


class UpdateProfileSerializer(serializers.Serializer[dict[str, Any]]):
    display_name = serializers.CharField(
        max_length=60, allow_blank=True, required=False
    )
    bio = serializers.CharField(max_length=300, allow_blank=True, required=False)
    is_private = serializers.BooleanField(required=False)


class FollowRequestSerializer(serializers.Serializer[dict[str, Any]]):
    """A pending request, from the perspective of the account being asked."""

    follower = UserSerializer(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)


class RespondToRequestSerializer(serializers.Serializer[dict[str, Any]]):
    accept = serializers.BooleanField()


class UserListSerializer(serializers.Serializer[dict[str, Any]]):
    users = UserSerializer(many=True, read_only=True)


class FollowStateSerializer(serializers.Serializer[dict[str, Any]]):
    """What the follow button should read after acting."""

    follow_state = serializers.ChoiceField(
        choices=["none", "pending", "accepted"], read_only=True
    )


class PasswordResetRequestSerializer(serializers.Serializer[dict[str, Any]]):
    """Ask for a link. An address, and nothing else."""

    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer[dict[str, Any]]):
    """Complete a reset.

    `uid` and `token` come straight back out of the link, so they are opaque
    strings here — validating their shape would only move the same rejection
    earlier and give a probe a way to tell malformed from wrong.
    """

    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True)
