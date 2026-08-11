"""Writes for the users app.

Business transactions live here, and this is the only place `.save()` is
called. Anything published to Redis is published *after* the transaction
commits, never inside it -- see `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

from django.contrib.auth import authenticate, login, logout
from django.http import HttpRequest

from users.models import User


class AuthenticationFailedError(Exception):
    """Wrong credentials, or an account that may not sign in."""


def start_session(request: HttpRequest, *, email: str, password: str) -> User:
    """Authenticate and attach a session to the request.

    Django rotates the session key on `login()`, which is what makes session
    fixation a non-issue. The cookie goes back same-site because the browser
    reached us through Next's `/api/*` rewrite.

    The failure message is deliberately identical whether the email is
    unknown or the password is wrong: distinguishing them turns this endpoint
    into an account-enumeration oracle.
    """
    user = authenticate(request, username=email, password=password)

    if user is None or not isinstance(user, User):
        raise AuthenticationFailedError("Email or password is incorrect.")
    if not user.is_active or user.deleted_at is not None:
        raise AuthenticationFailedError("Email or password is incorrect.")

    login(request, user)
    return user


def end_session(request: HttpRequest) -> None:
    """Flush the session. Safe to call when there is not one."""
    logout(request)
