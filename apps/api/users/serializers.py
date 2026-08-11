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


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    """Credentials. Email is the login identifier here, not username."""

    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
