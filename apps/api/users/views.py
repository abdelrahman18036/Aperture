"""Views for the users app.

Thin by rule: parse the request, call a selector or a service, return. A view
that queries the ORM directly is the smell -- move it to `selectors.py`.
"""

from __future__ import annotations

from typing import Any

from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from counters.models import Counter
from counters.selectors import get_metrics
from moderation.throttling import FollowThrottle, make_throttle
from users import selectors, services
from users.models import User
from users.serializers import (
    CurrentUserSerializer,
    FollowRequestPageSerializer,
    FollowStateSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileSerializer,
    RegisterSerializer,
    RespondToRequestSerializer,
    UpdateProfileSerializer,
    UserListSerializer,
    UserSerializer,
)
from users.services import (
    AuthenticationFailedError,
    end_session,
    start_session,
)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class RegisterView(APIView):
    """`POST /api/users/register` — open an account and sign in.

    Rate-limited on the same bucket as follows: account creation is cheap for
    us and cheap for a script, and this is the endpoint that fills a database
    with nobody.
    """

    permission_classes = [AllowAny]
    throttle_classes = [make_throttle("follow")]

    @extend_schema(
        operation_id="users_register",
        request=RegisterSerializer,
        responses={201: CurrentUserSerializer, 400: None},
        description="Create an account. Signs the new account in.",
    )
    def post(self, request: Request) -> Response:
        form = RegisterSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        try:
            user = services.register(
                request._request,  # noqa: SLF001
                email=form.validated_data["email"],
                username=form.validated_data["username"],
                password=form.validated_data["password"],
            )
        except services.RegistrationRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            CurrentUserSerializer(user).data, status=status.HTTP_201_CREATED
        )


class SessionView(APIView):
    """`/api/users/session` — sign in and out.

    Session cookies rather than a token in `localStorage`. The `/api/*`
    rewrite makes this same-origin, so the cookie is same-site, CSRF works the
    way Django expects, and there is no bearer token for a cross-site script
    to steal. See `01-ARCHITECTURE.md` §3.

    `ensure_csrf_cookie` means the sign-in page gets a CSRF token merely by
    asking who is signed in, which is the request it makes anyway.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        operation_id="session_create",
        request=LoginSerializer,
        responses={200: CurrentUserSerializer, 400: None},
        description="Sign in with email and password.",
    )
    def post(self, request: Request) -> Response:
        form = LoginSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        try:
            user = start_session(
                request._request,  # noqa: SLF001
                email=form.validated_data["email"],
                password=form.validated_data["password"],
            )
        except AuthenticationFailedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(CurrentUserSerializer(user).data)

    @extend_schema(
        operation_id="session_destroy",
        responses={204: None},
        description="Sign out. Idempotent.",
    )
    def delete(self, request: Request) -> Response:
        end_session(request._request)  # noqa: SLF001
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CurrentUserView(APIView):
    """`/api/users/me` — who is signed in.

    Also the request that seeds the CSRF cookie, since the client makes it on
    load anyway.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="users_me",
        responses={200: CurrentUserSerializer, 403: None},
        description="The signed-in user.",
    )
    def get(self, request: Request) -> Response:
        return Response(CurrentUserSerializer(current_user(request)).data)

    @extend_schema(
        operation_id="users_update_me",
        request=UpdateProfileSerializer,
        responses={200: CurrentUserSerializer, 400: None, 403: None},
        description="Update your own profile.",
    )
    def patch(self, request: Request) -> Response:
        form = UpdateProfileSerializer(data=request.data, partial=True)
        form.is_valid(raise_exception=True)
        try:
            user = services.update_profile(
                user=current_user(request), **form.validated_data
            )
        except services.ProfileRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CurrentUserSerializer(user).data)

    @extend_schema(
        operation_id="users_delete_me",
        responses={204: None, 403: None},
        description=(
            "Delete your account. Content disappears from every read path "
            "immediately; the rows are erased permanently after a grace "
            "period."
        ),
    )
    def delete(self, request: Request) -> Response:
        services.delete_account(user=current_user(request))
        # Ending the session is an HTTP concern, so it happens here rather
        # than in the service.
        end_session(request._request)  # noqa: SLF001
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProfileView(APIView):
    """`GET /api/users/{username}` — a profile header.

    A blocked account is indistinguishable from a missing one: "this user has
    blocked you" is information the blocker did not agree to share.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="users_profile",
        responses={200: ProfileSerializer, 404: None},
        description="One account's public profile, with its counts.",
    )
    def get(self, request: Request, username: str) -> Response:
        viewer = current_user(request)
        user = selectors.visible_profile(viewer=viewer, username=username)
        if user is None:
            raise NotFound("No such account.")

        counts = get_metrics(
            entity_type=Counter.EntityType.USER,
            entity_id=user.pk,
            metrics=[
                Counter.Metric.POSTS,
                Counter.Metric.FOLLOWERS,
                Counter.Metric.FOLLOWING,
            ],
        )
        states = selectors.follow_states(viewer=viewer, user_ids=[user.pk])

        return Response(
            ProfileSerializer(
                {
                    # The instance, not `UserSerializer(user).data`.
                    # `ProfileSerializer.user` is itself a `UserSerializer`,
                    # so passing a dict serialises the same user twice — and
                    # the second pass gets a `ReturnDict`, which has no model
                    # attributes on it. Harmless while every field was plain,
                    # a 500 the moment one of them reads `avatar_media`.
                    "user": user,
                    "post_count": counts[Counter.Metric.POSTS],
                    "follower_count": counts[Counter.Metric.FOLLOWERS],
                    "following_count": counts[Counter.Metric.FOLLOWING],
                    "follow_state": states.get(user.pk, "none"),
                    "is_self": viewer.pk == user.pk,
                    "can_view_posts": selectors.can_view_posts(
                        viewer=viewer, author=user
                    ),
                }
            ).data
        )


class FollowView(APIView):
    """`POST`/`DELETE /api/users/{username}/follow`.

    A private account yields `pending` and moves no follower count: a request
    is not a follow.
    """

    permission_classes = [IsAuthenticated]
    # Follow-spam is the first abuse you will see -- §11.
    throttle_classes = [FollowThrottle]

    def _target_or_404(self, request: Request, username: str) -> User:
        user = selectors.visible_profile(
            viewer=current_user(request), username=username
        )
        if user is None:
            raise NotFound("No such account.")
        return user

    @extend_schema(
        operation_id="users_follow",
        request=None,
        responses={200: FollowStateSerializer, 403: None, 404: None},
        description="Follow, or request to follow a private account.",
    )
    def post(self, request: Request, username: str) -> Response:
        viewer = current_user(request)
        target = self._target_or_404(request, username)
        try:
            edge = services.follow(follower=viewer, followee=target)
        except services.NotAllowedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response({"follow_state": edge.status})

    @extend_schema(
        operation_id="users_unfollow",
        responses={200: FollowStateSerializer, 404: None},
        description="Unfollow, or withdraw a pending request.",
    )
    def delete(self, request: Request, username: str) -> Response:
        viewer = current_user(request)
        target = self._target_or_404(request, username)
        services.unfollow(follower=viewer, followee=target)
        return Response({"follow_state": "none"})


class FollowRequestsView(APIView):
    """`GET /api/users/requests` — who is waiting on your approval."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="users_follow_requests",
        parameters=[
            OpenApiParameter(
                name="cursor",
                description=(
                    "Follow id of the last request on the previous page. Ids "
                    "are time-ordered, so this is simply 'older than that "
                    "one'."
                ),
                required=False,
                type=str,
            )
        ],
        responses={200: FollowRequestPageSerializer},
        description="Pending follow requests, newest first, cursor-paginated.",
    )
    def get(self, request: Request) -> Response:
        raw_cursor = request.query_params.get("cursor")
        try:
            before_id = int(raw_cursor) if raw_cursor else None
        except ValueError:
            before_id = None

        pending = list(
            selectors.pending_requests_for(current_user(request), before_id=before_id)
        )
        payload: list[dict[str, Any]] = [
            {
                # The instance, for the same reason as in ProfileView.
                "follower": edge.follower,
                "created_at": edge.created_at,
            }
            for edge in pending
        ]
        # A full page means there is probably another; a short one is the end.
        next_cursor = (
            str(pending[-1].pk) if len(pending) == selectors.REQUEST_PAGE_SIZE else None
        )
        return Response(
            FollowRequestPageSerializer(
                {"requests": payload, "next_cursor": next_cursor}
            ).data
        )


class RespondToRequestView(APIView):
    """`POST /api/users/{username}/respond` — approve or decline."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="users_respond_to_request",
        request=RespondToRequestSerializer,
        responses={204: None, 403: None, 404: None},
        description="Approve or decline a pending follow request.",
    )
    def post(self, request: Request, username: str) -> Response:
        form = RespondToRequestSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        follower = selectors.by_username(username)
        if follower is None:
            raise NotFound("No such account.")

        try:
            services.respond_to_request(
                followee=current_user(request),
                follower=follower,
                accept=form.validated_data["accept"],
            )
        except services.NotAllowedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(status=status.HTTP_204_NO_CONTENT)


class BlockView(APIView):
    """`POST`/`DELETE /api/users/{username}/block`.

    Blocking severs any follow in either direction. A block that leaves them
    following you means their feed still shows your posts, which is precisely
    what the user asked to stop.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="users_block",
        request=None,
        responses={204: None, 403: None, 404: None},
        description="Block an account, severing follows both ways.",
    )
    def post(self, request: Request, username: str) -> Response:
        target = selectors.by_username(username)
        if target is None:
            raise NotFound("No such account.")
        try:
            services.block(blocker=current_user(request), blocked=target)
        except services.NotAllowedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        operation_id="users_unblock",
        responses={204: None, 404: None},
        description="Unblock. Does not restore the follows that blocking severed.",
    )
    def delete(self, request: Request, username: str) -> Response:
        target = selectors.by_username(username)
        if target is None:
            raise NotFound("No such account.")
        services.unblock(blocker=current_user(request), blocked=target)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SearchView(APIView):
    """`GET /api/users/search?q=` — block-filtered account search.

    Rule 8 applies here as much as to the feed: being blocked and still
    turning up in search is the same failure wearing a hat.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="users_search",
        parameters=[
            OpenApiParameter(name="q", required=True, type=str, description="Query"),
        ],
        responses={200: UserListSerializer},
        description="Find accounts by username or display name.",
    )
    def get(self, request: Request) -> Response:
        matches = selectors.search(
            viewer=current_user(request), query=request.query_params.get("q", "")
        )
        return Response({"users": UserSerializer(matches, many=True).data})


class PasswordResetView(APIView):
    """`POST /api/users/password/reset` — ask for a link.

    **Always 204.** Answering 404 for an unknown address would make this an
    account-enumeration endpoint that needs no credentials at all, which is
    strictly worse than the sign-in oracle `start_session` avoids.
    """

    permission_classes = [AllowAny]
    throttle_classes = [make_throttle("password_reset")]

    @extend_schema(
        operation_id="users_password_reset",
        request=PasswordResetRequestSerializer,
        responses={204: None, 400: None, 429: None},
        description=(
            "Mail a password reset link. Answers 204 whether or not the "
            "address is known."
        ),
    )
    def post(self, request: Request) -> Response:
        form = PasswordResetRequestSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        services.request_password_reset(email=form.validated_data["email"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(APIView):
    """`POST /api/users/password/reset/confirm` — set the new password.

    Does not sign the account in afterwards. The reset has just invalidated
    every session the account had, and quietly opening a new one here would
    undo that for whoever happens to be holding the link.
    """

    permission_classes = [AllowAny]
    throttle_classes = [make_throttle("password_reset")]

    @extend_schema(
        operation_id="users_password_reset_confirm",
        request=PasswordResetConfirmSerializer,
        responses={204: None, 400: None, 429: None},
        description="Complete a password reset and sign every session out.",
    )
    def post(self, request: Request) -> Response:
        form = PasswordResetConfirmSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        try:
            services.reset_password(
                uid=form.validated_data["uid"],
                token=form.validated_data["token"],
                password=form.validated_data["password"],
            )
        except services.PasswordResetRejectedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)
