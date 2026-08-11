"""Writes for the users app.

Business transactions live here, and this is the only place `.save()` is
called. Anything published to Redis is published *after* the transaction
commits, never inside it -- see `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.http import HttpRequest

from counters.models import Counter
from counters.tasks import adjust
from users.models import Block, Follow, User


class AuthenticationFailedError(Exception):
    """Wrong credentials, or an account that may not sign in."""


class NotAllowedError(Exception):
    """A relationship change the caller is not entitled to make."""


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Follows
# ---------------------------------------------------------------------------


def _bump(entity_type: str, entity_id: int, metric: str, delta: int) -> None:
    """Enqueue a counter move once the surrounding transaction commits.

    Inside the transaction it would increment for a follow that then rolls
    back — the same class of mistake as publishing a socket event early.
    """
    transaction.on_commit(lambda: adjust.delay(entity_type, entity_id, metric, delta))


@transaction.atomic
def follow(*, follower: User, followee: User) -> Follow:
    """Follow, or request to follow a private account.

    Idempotent: following twice returns the existing edge rather than raising.
    A private account yields `pending` and no follower count moves until it is
    accepted — a request is not a follow.
    """
    if follower.pk == followee.pk:
        raise NotAllowedError("You cannot follow yourself.")
    if Block.objects.filter(
        blocker__in=[follower, followee], blocked__in=[follower, followee]
    ).exists():
        # Deliberately vague: confirming a block reveals it.
        raise NotAllowedError("That account is unavailable.")

    existing = Follow.objects.filter(follower=follower, followee=followee).first()
    if existing is not None:
        return existing

    status = Follow.Status.PENDING if followee.is_private else Follow.Status.ACCEPTED
    try:
        edge = Follow.objects.create(
            follower=follower, followee=followee, status=status
        )
    except IntegrityError:
        # Two clicks, one transaction each. The constraint decided; read it back.
        existing = Follow.objects.filter(follower=follower, followee=followee).first()
        if existing is None:
            raise
        return existing

    if status == Follow.Status.ACCEPTED:
        _bump(Counter.EntityType.USER, followee.pk, Counter.Metric.FOLLOWERS, 1)
        _bump(Counter.EntityType.USER, follower.pk, Counter.Metric.FOLLOWING, 1)

    return edge


@transaction.atomic
def unfollow(*, follower: User, followee: User) -> None:
    """Unfollow, or withdraw a pending request. Idempotent."""
    edge = Follow.objects.filter(follower=follower, followee=followee).first()
    if edge is None:
        return

    was_accepted = edge.status == Follow.Status.ACCEPTED
    edge.delete()

    if was_accepted:
        _bump(Counter.EntityType.USER, followee.pk, Counter.Metric.FOLLOWERS, -1)
        _bump(Counter.EntityType.USER, follower.pk, Counter.Metric.FOLLOWING, -1)


@transaction.atomic
def respond_to_request(*, followee: User, follower: User, accept: bool) -> None:
    """Approve or decline a pending follow request.

    Only the account being followed may do this, which is why `followee` is
    the first argument rather than something read off the edge.
    """
    edge = Follow.objects.filter(
        follower=follower, followee=followee, status=Follow.Status.PENDING
    ).first()
    if edge is None:
        raise NotAllowedError("There is no pending request from that account.")

    if not accept:
        edge.delete()
        return

    edge.status = Follow.Status.ACCEPTED
    edge.save(update_fields=["status"])
    _bump(Counter.EntityType.USER, followee.pk, Counter.Metric.FOLLOWERS, 1)
    _bump(Counter.EntityType.USER, follower.pk, Counter.Metric.FOLLOWING, 1)


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------


@transaction.atomic
def block(*, blocker: User, blocked: User) -> Block:
    """Block someone, severing any follow in either direction.

    The severing is the part that is easy to forget and impossible to explain
    away: a block that leaves them following you means their feed still shows
    your posts, which is precisely what the user asked to stop.
    """
    if blocker.pk == blocked.pk:
        raise NotAllowedError("You cannot block yourself.")

    edge, created = Block.objects.get_or_create(blocker=blocker, blocked=blocked)
    if not created:
        return edge

    for follower, followee in ((blocker, blocked), (blocked, blocker)):
        unfollow(follower=follower, followee=followee)

    return edge


@transaction.atomic
def unblock(*, blocker: User, blocked: User) -> None:
    """Unblock. Does **not** restore the follows that blocking severed.

    Restoring them would silently re-expose content to someone the user had
    deliberately cut off. If they want to follow again, they can.
    """
    Block.objects.filter(blocker=blocker, blocked=blocked).delete()


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


@transaction.atomic
def delete_account(*, user: User) -> User:
    """The user asked to leave.

    Soft delete now, permanent erasure on a schedule — `01-ARCHITECTURE.md`
    §11 requires both, and the grace period is what makes an accidental
    deletion recoverable by asking rather than by restoring a backup.

    The session is not ended here; the view does that, because ending it is
    an HTTP concern rather than a data one.

    Their content disappears immediately even though the rows survive: every
    base selector filters on the author's `deleted_at`, so the delay before
    the hard delete is invisible from outside.
    """
    from django.utils import timezone

    if user.deleted_at is not None:
        return user

    user.deleted_at = timezone.now()
    user.is_active = False
    user.save(update_fields=["deleted_at", "is_active"])
    return user


def update_profile(
    *,
    user: User,
    display_name: str | None = None,
    bio: str | None = None,
    is_private: bool | None = None,
) -> User:
    fields: list[str] = []
    if display_name is not None:
        user.display_name = display_name
        fields.append("display_name")
    if bio is not None:
        user.bio = bio
        fields.append("bio")
    if is_private is not None:
        user.is_private = is_private
        fields.append("is_private")

    if fields:
        user.save(update_fields=fields)
    return user
