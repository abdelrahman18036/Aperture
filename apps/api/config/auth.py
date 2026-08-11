"""Narrowing `request.user` for the type checker.

DRF types `request.user` as `User | AnonymousUser` because it cannot see that
`permission_classes = [IsAuthenticated]` already excluded one of them. Rather
than cast at every call site — or worse, loosen the signatures of every
selector and service to accept an anonymous user they can do nothing with —
the narrowing happens once, here.
"""

from __future__ import annotations

from rest_framework.request import Request

from users.models import User


def current_user(request: Request) -> User:
    """The signed-in user.

    Only valid on a view whose permissions guarantee authentication. Raises
    rather than returning something unusable if that guarantee is ever broken,
    because the alternative is a query silently scoped to nobody.

    No cast needed: django-stubs types `is_authenticated` as `Literal[True]`
    on `User` and `Literal[False]` on `AnonymousUser`, so the check narrows
    the union on its own.
    """
    user = request.user
    if not user.is_authenticated:
        raise PermissionError(
            "current_user() called on an unauthenticated request; check "
            "permission_classes on this view"
        )
    return user
