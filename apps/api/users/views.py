"""Views for the users app.

Thin by rule: parse the request, call a selector or a service, return. A view
that queries the ORM directly is the smell -- move it to `selectors.py`.
"""

from __future__ import annotations

from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from users.serializers import CurrentUserSerializer, LoginSerializer
from users.services import AuthenticationFailedError, end_session, start_session


@method_decorator(ensure_csrf_cookie, name="dispatch")
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
