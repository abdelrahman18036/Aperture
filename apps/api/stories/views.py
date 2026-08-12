"""Views for the stories app.

Thin by rule: parse the request, call a selector or a service, return.

Every route here is named rather than sitting at a bare collection path. The
reason is recorded in `calls/urls.py` and cost this codebase a 500 on the
publish endpoint: Next normalises a trailing slash away on the `/api/*`
rewrite, and Django will not `APPEND_SLASH`-redirect a POST, because the
redirect would drop the body.
"""

from __future__ import annotations

from itertools import groupby
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from messaging.serializers import MessageSerializer
from messaging.services import MessagingRejectedError
from moderation.throttling import make_throttle
from stories import selectors, services
from stories.models import Story
from stories.serializers import (
    CreateStorySerializer,
    ReactToStorySerializer,
    ReplyToStorySerializer,
    StorySerializer,
    StoryTrayEntrySerializer,
    StoryViewerSerializer,
)
from users import selectors as user_selectors


class TrayView(APIView):
    """`GET /api/stories/tray` — your stories and those of accounts you follow."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="stories_tray",
        responses={200: StoryTrayEntrySerializer(many=True)},
        description="Live stories, grouped by author and ordered newest first.",
    )
    def get(self, request: Request) -> Response:
        viewer = current_user(request)
        stories = list(selectors.visible_to(viewer))
        seen = selectors.seen_ids(
            viewer=viewer, story_ids=[story.pk for story in stories]
        )

        # Grouped in Python rather than in SQL. The set is one tray's worth by
        # construction — the people you follow who posted today — so a window
        # function here would be cleverness with nothing to buy.
        entries: list[dict[str, Any]] = []
        by_author = sorted(stories, key=lambda story: story.author_id)
        for _, group in groupby(by_author, key=lambda story: story.author_id):
            owned = list(group)
            # Where the viewer should be put when they open this entry:
            # their first unwatched frame. Landing on frame one of four when
            # three are already seen means tapping past your own history to
            # reach the new thing.
            unseen = next(
                (index for index, story in enumerate(owned) if story.pk not in seen),
                0,
            )
            entries.append(
                {
                    "author": owned[0].author,
                    "stories": owned,
                    "first_unseen": unseen,
                    # Your own entry is never "unwatched" — you posted it.
                    "all_seen": owned[0].author_id == viewer.pk
                    or all(story.pk in seen for story in owned),
                    "latest_at": owned[-1].created_at,
                }
            )

        # Unwatched first, then most recent. This ordering is what makes the
        # ring mean anything: it puts what you have not seen where you look.
        entries.sort(
            key=lambda entry: (entry["all_seen"], -entry["latest_at"].timestamp())
        )

        return Response(
            StoryTrayEntrySerializer(
                entries,  # type: ignore[arg-type]
                many=True,
                context={
                    "viewer_reactions": selectors.viewer_reactions(
                        viewer=viewer, story_ids=[story.pk for story in stories]
                    )
                },
            ).data
        )


class CreateStoryView(APIView):
    """`POST /api/stories/create` — post one."""

    permission_classes = [IsAuthenticated]
    # The upload bucket. A story is an upload, and limiting posts while
    # leaving stories open would just move the abuse one endpoint across.
    throttle_classes = [make_throttle("upload")]

    @extend_schema(
        operation_id="stories_create",
        request=CreateStorySerializer,
        responses={201: StorySerializer, 400: None},
        description="Post a story from media that has finished processing.",
    )
    def post(self, request: Request) -> Response:
        form = CreateStorySerializer(data=request.data)
        form.is_valid(raise_exception=True)

        try:
            raw_media = form.validated_data["media_id"]
            story = services.create_story(
                author=current_user(request),
                media_id=int(raw_media) if raw_media else None,
                caption=form.validated_data["caption"],
                text=form.validated_data["text"],
                background=form.validated_data["background"],
            )
        except (services.StoryRejectedError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(StorySerializer(story).data, status=status.HTTP_201_CREATED)


class AuthorStoriesView(APIView):
    """`GET /api/stories/by/{username}` — one account's live stories."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="stories_by_author",
        responses={200: StorySerializer(many=True), 404: None},
        description="Live stories for one account, oldest first.",
    )
    def get(self, request: Request, username: str) -> Response:
        viewer = current_user(request)
        author = user_selectors.visible_profile(viewer=viewer, username=username)
        if author is None:
            raise NotFound("No such account.")
        if not user_selectors.can_view_posts(viewer=viewer, author=author):
            # A private account's stories follow its posts. 404 rather than
            # 403 keeps "this account exists" out of the reply.
            raise NotFound("No such account.")

        stories = list(selectors.by_author(viewer=viewer, author=author))
        return Response(
            StorySerializer(
                stories,
                many=True,
                context={
                    "viewer_reactions": selectors.viewer_reactions(
                        viewer=viewer, story_ids=[story.pk for story in stories]
                    )
                },
            ).data
        )


class StoryReactionView(APIView):
    """`POST`/`DELETE /api/stories/{story_id}/react`."""

    permission_classes = [IsAuthenticated]

    def _story(self, request: Request, story_id: int) -> Story:
        story = selectors.live(current_user(request)).filter(pk=story_id).first()
        if story is None:
            raise NotFound("That story has expired or does not exist.")
        return story

    @extend_schema(
        operation_id="stories_react",
        request=ReactToStorySerializer,
        responses={204: None, 400: None, 404: None},
        description="React to a story. Reacting again replaces the reaction.",
    )
    def post(self, request: Request, story_id: int) -> Response:
        form = ReactToStorySerializer(data=request.data)
        form.is_valid(raise_exception=True)
        try:
            services.react(
                story=self._story(request, story_id),
                user=current_user(request),
                emoji=form.validated_data["emoji"],
            )
        except services.StoryRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        operation_id="stories_unreact",
        responses={204: None, 404: None},
        description="Take a reaction back. Idempotent.",
    )
    def delete(self, request: Request, story_id: int) -> Response:
        services.unreact(
            story=self._story(request, story_id), user=current_user(request)
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class StoryReplyView(APIView):
    """`POST /api/stories/{story_id}/reply` — answer a story in a DM."""

    permission_classes = [IsAuthenticated]
    # The same bucket messages use: a story reply *is* a message, so it should
    # not be a way around the limit on sending them.
    throttle_classes = [make_throttle("message")]

    @extend_schema(
        operation_id="stories_reply",
        request=ReplyToStorySerializer,
        responses={200: MessageSerializer, 400: None, 404: None},
        description="Reply to a story. Lands in the direct conversation.",
    )
    def post(self, request: Request, story_id: int) -> Response:
        story = selectors.live(current_user(request)).filter(pk=story_id).first()
        if story is None:
            raise NotFound("That story has expired or does not exist.")

        form = ReplyToStorySerializer(data=request.data)
        form.is_valid(raise_exception=True)
        try:
            message = services.reply(
                story=story,
                user=current_user(request),
                body=form.validated_data["body"],
                client_id=str(form.validated_data["client_id"]),
            )
        except (services.StoryRejectedError, MessagingRejectedError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MessageSerializer(message).data)


class StoryDetailView(APIView):
    """`/api/stories/{story_id}` — watch it, or take it down."""

    permission_classes = [IsAuthenticated]

    def _story(self, request: Request, story_id: int) -> Story:
        story = selectors.live(current_user(request)).filter(pk=story_id).first()
        if story is None:
            raise NotFound("That story has expired or does not exist.")
        return story

    @extend_schema(
        operation_id="stories_view",
        request=None,
        responses={204: None, 404: None},
        description="Record that you watched it. Idempotent.",
    )
    def post(self, request: Request, story_id: int) -> Response:
        viewer = current_user(request)
        services.mark_viewed(story=self._story(request, story_id), viewer=viewer)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        operation_id="stories_delete",
        responses={204: None, 404: None},
        description="Take down your own story.",
    )
    def delete(self, request: Request, story_id: int) -> Response:
        try:
            services.soft_delete_story(
                actor=current_user(request), story=self._story(request, story_id)
            )
        except services.StoryRejectedError:
            # 404 rather than 403. Whether somebody else's story exists is not
            # something a refused delete should confirm.
            raise NotFound("That story has expired or does not exist.") from None
        return Response(status=status.HTTP_204_NO_CONTENT)


class StoryViewersView(APIView):
    """`GET /api/stories/{story_id}/viewers` — who watched it. Author only."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="stories_viewers",
        responses={200: StoryViewerSerializer(many=True), 404: None},
        description="Who has watched your story, newest first.",
    )
    def get(self, request: Request, story_id: int) -> Response:
        viewer = current_user(request)
        story = selectors.live(viewer).filter(pk=story_id).first()
        # Yours only, and 404 rather than 403 — a viewer list is a list of
        # people, and confirming one exists already tells somebody something
        # about who watched what.
        if story is None or story.author_id != viewer.pk:
            raise NotFound("That story has expired or does not exist.")

        rows = [
            {"viewer": view.viewer, "created_at": view.created_at}
            for view in selectors.viewers_of(story)
        ]
        return Response(
            StoryViewerSerializer(rows, many=True).data  # type: ignore[arg-type]
        )
