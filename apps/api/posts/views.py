"""Views for the posts app.

Thin by rule: parse the request, call a selector or a service, return. A view
that queries the ORM directly is the smell -- move it to `selectors.py`.

The one thing these views do beyond that is **batch** — counts and
"have I liked this" are fetched once per page and handed to the serializer
through its context. That is not logic; it is the difference between four
queries and a hundred.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from counters.models import Counter
from counters.selectors import get_many
from posts import selectors, services
from posts.models import Comment, Post
from posts.serializers import (
    CommentPageSerializer,
    CommentSerializer,
    CreateCommentSerializer,
    CreatePostSerializer,
    PostPageSerializer,
    PostSerializer,
)
from users.models import User
from users.selectors import can_view_posts, visible_profile

CURSOR = OpenApiParameter(
    name="cursor",
    description=(
        "Snowflake id of the last item on the previous page. Ids are "
        "time-ordered, so this is simply 'older than that one'."
    ),
    required=False,
    type=str,
)


def _post_context(viewer: User | None, posts: list[Post]) -> dict[str, Any]:
    """Everything the serializer needs, fetched once for the whole page."""
    post_ids = [post.pk for post in posts]
    return {
        "like_counts": get_many(
            entity_type=Counter.EntityType.POST,
            entity_ids=post_ids,
            metric=Counter.Metric.LIKES,
        ),
        "comment_counts": get_many(
            entity_type=Counter.EntityType.POST,
            entity_ids=post_ids,
            metric=Counter.Metric.COMMENTS,
        ),
        "liked_post_ids": selectors.liked_post_ids(viewer=viewer, post_ids=post_ids),
    }


def _page(posts: list[Post], viewer: User | None, limit: int) -> dict[str, Any]:
    """A page plus its cursor. Null cursor means there is nothing older."""
    next_cursor = str(posts[-1].pk) if len(posts) == limit else None
    return {
        "posts": PostSerializer(
            posts, many=True, context=_post_context(viewer, posts)
        ).data,
        "next_cursor": next_cursor,
    }


def _cursor_of(request: Request) -> int | None:
    raw = request.query_params.get("cursor")
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _limit_of(request: Request) -> int:
    try:
        limit = int(request.query_params.get("limit", selectors.DEFAULT_PAGE_SIZE))
    except ValueError:
        return selectors.DEFAULT_PAGE_SIZE
    return max(1, min(limit, selectors.MAX_PAGE_SIZE))


class FeedView(APIView):
    """`GET /api/posts/feed` — the pull feed.

    Fresh on every request, block-filtered, cursor-paginated. See
    `01-ARCHITECTURE.md` §7 for why this is the right shape to start with and
    what would have to be measured before changing it.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="posts_feed",
        parameters=[CURSOR],
        responses={200: PostPageSerializer},
        description="Posts from accounts you follow, newest first.",
    )
    def get(self, request: Request) -> Response:
        viewer = current_user(request)
        limit = _limit_of(request)
        posts = list(
            selectors.feed(viewer=viewer, cursor=_cursor_of(request), limit=limit)
        )
        return Response(_page(posts, viewer, limit))


class PostListView(APIView):
    """`POST /api/posts` — publish."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="posts_create",
        request=CreatePostSerializer,
        responses={201: PostSerializer, 400: None},
        description="Publish a post from media that has finished processing.",
    )
    def post(self, request: Request) -> Response:
        form = CreatePostSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        author = current_user(request)

        try:
            post = services.create_post(
                author=author,
                media_ids=[int(value) for value in form.validated_data["media_ids"]],
                caption=form.validated_data["caption"],
                location=form.validated_data["location"],
                visibility=form.validated_data["visibility"],
            )
        except (services.PostRejectedError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        fresh = selectors.visible_post(viewer=author, post_id=post.pk)
        if fresh is None:  # pragma: no cover — it was just written
            raise NotFound("No such post.")
        return Response(
            PostSerializer(fresh, context=_post_context(author, [fresh])).data,
            status=status.HTTP_201_CREATED,
        )


class PostDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="posts_retrieve",
        responses={200: PostSerializer, 404: None},
        description="One post.",
    )
    def get(self, request: Request, post_id: str) -> Response:
        viewer = current_user(request)
        post = selectors.visible_post(viewer=viewer, post_id=int(post_id))
        if post is None or not can_view_posts(viewer=viewer, author=post.author):
            raise NotFound("No such post.")
        return Response(
            PostSerializer(post, context=_post_context(viewer, [post])).data
        )

    @extend_schema(
        operation_id="posts_destroy",
        responses={204: None, 404: None},
        description="Soft delete your own post.",
    )
    def delete(self, request: Request, post_id: str) -> Response:
        post = selectors.post_owned_by(
            author=current_user(request), post_id=int(post_id)
        )
        if post is None:
            raise NotFound("No such post.")
        services.soft_delete_post(post=post)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LikeView(APIView):
    """`POST`/`DELETE /api/posts/{id}/like`.

    Both are idempotent, which is what lets the UI update optimistically and
    never have to reason about a double tap.
    """

    permission_classes = [IsAuthenticated]

    def _post_or_404(self, request: Request, post_id: str) -> Post:
        viewer = current_user(request)
        post = selectors.visible_post(viewer=viewer, post_id=int(post_id))
        if post is None or not can_view_posts(viewer=viewer, author=post.author):
            raise NotFound("No such post.")
        return post

    @extend_schema(
        operation_id="posts_like",
        request=None,
        responses={200: PostSerializer, 404: None},
        description="Like a post. Idempotent.",
    )
    def post(self, request: Request, post_id: str) -> Response:
        viewer = current_user(request)
        post = self._post_or_404(request, post_id)
        try:
            services.like(user=viewer, post=post)
        except services.NotAllowedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(
            PostSerializer(post, context=_post_context(viewer, [post])).data
        )

    @extend_schema(
        operation_id="posts_unlike",
        responses={200: PostSerializer, 404: None},
        description="Remove a like. Idempotent.",
    )
    def delete(self, request: Request, post_id: str) -> Response:
        viewer = current_user(request)
        post = self._post_or_404(request, post_id)
        services.unlike(user=viewer, post=post)
        return Response(
            PostSerializer(post, context=_post_context(viewer, [post])).data
        )


class CommentListView(APIView):
    permission_classes = [IsAuthenticated]

    def _post_or_404(self, request: Request, post_id: str) -> Post:
        viewer = current_user(request)
        post = selectors.visible_post(viewer=viewer, post_id=int(post_id))
        if post is None or not can_view_posts(viewer=viewer, author=post.author):
            raise NotFound("No such post.")
        return post

    @extend_schema(
        operation_id="posts_comments_list",
        parameters=[CURSOR],
        responses={200: CommentPageSerializer, 404: None},
        description="Top-level comments, oldest first.",
    )
    def get(self, request: Request, post_id: str) -> Response:
        viewer = current_user(request)
        post = self._post_or_404(request, post_id)
        limit = _limit_of(request)
        comments = list(
            selectors.comments_for(
                viewer=viewer, post=post, cursor=_cursor_of(request), limit=limit
            )
        )
        reply_counts = get_many(
            entity_type=Counter.EntityType.COMMENT,
            entity_ids=[comment.pk for comment in comments],
            metric=Counter.Metric.REPLIES,
        )
        return Response(
            {
                "comments": CommentSerializer(
                    comments, many=True, context={"reply_counts": reply_counts}
                ).data,
                "next_cursor": (
                    str(comments[-1].pk) if len(comments) == limit else None
                ),
            }
        )

    @extend_schema(
        operation_id="posts_comments_create",
        request=CreateCommentSerializer,
        responses={201: CommentSerializer, 400: None, 404: None},
        description="Comment on a post, or reply to a comment.",
    )
    def post(self, request: Request, post_id: str) -> Response:
        viewer = current_user(request)
        post = self._post_or_404(request, post_id)

        form = CreateCommentSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        parent: Comment | None = None
        raw_parent = form.validated_data["parent_id"]
        if raw_parent:
            parent = Comment.objects.filter(
                pk=int(raw_parent), deleted_at__isnull=True
            ).first()
            if parent is None:
                raise NotFound("No such comment.")

        try:
            comment = services.add_comment(
                author=viewer,
                post=post,
                body=form.validated_data["body"],
                parent=parent,
            )
        except services.PostRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except services.NotAllowedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        return Response(
            CommentSerializer(comment, context={"reply_counts": {}}).data,
            status=status.HTTP_201_CREATED,
        )


class CommentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="posts_comments_destroy",
        responses={204: None, 404: None},
        description="Soft delete your own comment.",
    )
    def delete(self, request: Request, comment_id: str) -> Response:
        comment = selectors.comment_owned_by(
            author=current_user(request), comment_id=int(comment_id)
        )
        if comment is None:
            raise NotFound("No such comment.")
        services.soft_delete_comment(comment=comment)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserPostsView(APIView):
    """`GET /api/posts/by/{username}` — the profile contact sheet."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="posts_by_user",
        parameters=[CURSOR],
        responses={200: PostPageSerializer, 404: None},
        description="One account's posts, newest first.",
    )
    def get(self, request: Request, username: str) -> Response:
        viewer = current_user(request)
        author = visible_profile(viewer=viewer, username=username)
        if author is None:
            raise NotFound("No such account.")
        if not can_view_posts(viewer=viewer, author=author):
            # A private account the viewer does not follow: the account exists
            # and says so, but its posts do not appear.
            return Response({"posts": [], "next_cursor": None})

        limit = _limit_of(request)
        posts = list(
            selectors.by_author(
                viewer=viewer,
                author=author,
                cursor=_cursor_of(request),
                limit=limit,
            )
        )
        return Response(_page(posts, viewer, limit))
