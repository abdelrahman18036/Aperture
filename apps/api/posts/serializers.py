"""DRF shapes for the posts app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.

These feed drf-spectacular, which generates `packages/api-client`. A change
here is a change to the frontend's types -- regenerate in the same commit.

Counts and "have I liked this" arrive through the serializer **context**,
already batched by the view. A serializer that queried for them per row would
be an N+1 on the hottest page in the product, and rule 9 forbids the `.count()`
it would take to answer.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from config.fields import SnowflakeField
from links.serializers import LinkPreviewSerializer
from media.serializers import MediaSerializer
from posts.models import Comment, Post
from users.serializers import UserSerializer


class PostSerializer(serializers.ModelSerializer[Post]):
    """A post as the feed and the contact sheet see it."""

    id = SnowflakeField(read_only=True)
    author = UserSerializer(read_only=True)
    media = serializers.SerializerMethodField()
    #: Declared, or `ModelSerializer` emits the foreign key as a bare integer
    #: — which is both useless to a client and a snowflake crossing the wire
    #: as a JSON number.
    link_preview = LinkPreviewSerializer(read_only=True, allow_null=True)
    like_count = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    viewer_has_liked = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = (
            "id",
            "author",
            "caption",
            "location",
            "visibility",
            "created_at",
            "media",
            "link_preview",
            "like_count",
            "comment_count",
            "viewer_has_liked",
        )
        read_only_fields = fields

    @extend_schema_field(MediaSerializer(many=True))
    def get_media(self, post: Post) -> list[dict[str, Any]]:
        # `attachments` is prefetched and already ordered by position, so this
        # touches no database.
        return [
            MediaSerializer(attachment.media).data
            for attachment in post.attachments.all()
        ]

    @extend_schema_field(serializers.IntegerField())
    def get_like_count(self, post: Post) -> int:
        counts: dict[int, int] = self.context.get("like_counts", {})
        return counts.get(post.pk, 0)

    @extend_schema_field(serializers.IntegerField())
    def get_comment_count(self, post: Post) -> int:
        counts: dict[int, int] = self.context.get("comment_counts", {})
        return counts.get(post.pk, 0)

    @extend_schema_field(serializers.BooleanField())
    def get_viewer_has_liked(self, post: Post) -> bool:
        liked: set[int] = self.context.get("liked_post_ids", set())
        return post.pk in liked


class PostPageSerializer(serializers.Serializer[dict[str, Any]]):
    """A cursor-paginated page of posts.

    `next_cursor` is the id of the last post on the page, or null at the end.
    No total count: producing one means a `COUNT(*)` over the whole feed, and
    nothing in the UI shows it.
    """

    posts = PostSerializer(many=True, read_only=True)
    next_cursor = serializers.CharField(read_only=True, allow_null=True)


class CreatePostSerializer(serializers.Serializer[dict[str, Any]]):
    """Publishing a post from media that is already uploaded and processed."""

    media_ids = serializers.ListField(
        child=serializers.CharField(), min_length=1, max_length=10
    )
    caption = serializers.CharField(
        max_length=2200, allow_blank=True, required=False, default=""
    )
    location = serializers.CharField(
        max_length=120, allow_blank=True, required=False, default=""
    )
    visibility = serializers.ChoiceField(
        choices=Post.Visibility.choices, required=False, default=Post.Visibility.PUBLIC
    )


class CommentSerializer(serializers.ModelSerializer[Comment]):
    id = SnowflakeField(read_only=True)
    post_id = SnowflakeField(read_only=True)
    parent_id = SnowflakeField(read_only=True, allow_null=True)
    author = UserSerializer(read_only=True)
    reply_count = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = (
            "id",
            "post_id",
            "parent_id",
            "author",
            "body",
            "created_at",
            "reply_count",
        )
        read_only_fields = fields

    @extend_schema_field(serializers.IntegerField())
    def get_reply_count(self, comment: Comment) -> int:
        counts: dict[int, int] = self.context.get("reply_counts", {})
        return counts.get(comment.pk, 0)


class CommentPageSerializer(serializers.Serializer[dict[str, Any]]):
    comments = CommentSerializer(many=True, read_only=True)
    next_cursor = serializers.CharField(read_only=True, allow_null=True)


class CreateCommentSerializer(serializers.Serializer[dict[str, Any]]):
    body = serializers.CharField(max_length=2200)
    parent_id = serializers.CharField(required=False, allow_null=True, default=None)
