"""Writes for the users app.

Business transactions live here, and this is the only place `.save()` is
called. Anything published to Redis is published *after* the transaction
commits, never inside it -- see `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.http import HttpRequest
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from counters.models import Counter
from counters.tasks import adjust
from media.models import Media
from users.models import Block, Follow, User


class RegistrationRejectedError(Exception):
    """The account cannot be created. The message is safe to show a user."""


class AuthenticationFailedError(Exception):
    """Wrong credentials, or an account that may not sign in."""


class NotAllowedError(Exception):
    """A relationship change the caller is not entitled to make."""


class ProfileRejectedError(Exception):
    """The profile change cannot be applied. Safe to show a user."""


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


def register(request: HttpRequest, *, email: str, username: str, password: str) -> User:
    """Create an account and sign it straight in.

    Signing in as part of registering is not a shortcut — it is the only way
    the next screen has a session. Making someone log in immediately after
    choosing a password is a step that exists to serve the implementation.

    **Both collisions answer the same way, and deliberately.** Django's
    uniqueness errors would happily tell an anonymous caller which emails and
    usernames are taken, which is the account-enumeration oracle `start_session`
    is careful to avoid — undone by the endpoint next to it. A username is
    public and effectively enumerable anyway, so that one is named; the email
    is not.

    Password strength is Django's `AUTH_PASSWORD_VALIDATORS`, not a rule
    invented here. It already knows about common passwords and similarity to
    the rest of the account.
    """
    email = User.objects.normalize_email(email.strip())
    username = username.strip()

    if User.objects.filter(username__iexact=username).exists():
        raise RegistrationRejectedError("That username is taken.")
    if User.objects.filter(email__iexact=email).exists():
        # Not "that email is registered". See the docstring.
        raise RegistrationRejectedError(
            "That account could not be created. Try signing in instead."
        )

    try:
        validate_password(password)
    except DjangoValidationError as exc:
        raise RegistrationRejectedError(" ".join(exc.messages)) from exc

    user = User.objects.create_user(email=email, username=username, password=password)
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
def _forget_feed(*users: User) -> None:
    """Drop these users' cached feeds after the transaction commits.

    Anything that changes *which* accounts a feed draws from invalidates the
    whole set — a follow, an unfollow, a block. Rebuilding it correctly would
    mean running the query the cache exists to avoid, so it is dropped and the
    next read pays one miss.

    After commit, not inside it: a feed dropped for a transaction that then
    rolls back is a free cache miss, but a feed *rebuilt* mid-transaction
    would be built from rows nobody else can see yet.
    """
    from posts import cache

    ids = [user.pk for user in users]
    transaction.on_commit(lambda: cache.drop(user_ids=ids))


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
        _forget_feed(follower)

    # A request and a follow are different news: one asks something of the
    # recipient and the other does not, and collapsing them would put an
    # actionable row and a courtesy row in the same shape.
    from notifications.models import Notification
    from notifications.services import notify

    notify(
        recipient=followee,
        actor=follower,
        verb=(
            Notification.Verb.FOLLOW
            if status == Follow.Status.ACCEPTED
            else Notification.Verb.FOLLOW_REQUEST
        ),
    )

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
        _forget_feed(follower)


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
    # Accepting is when the edge starts feeding a timeline, so it is the
    # moment the requester's cached feed becomes wrong.
    _forget_feed(follower)


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

    # Both sides. A block hides each from the other, so both cached feeds are
    # now wrong — and `unfollow` above only drops the ones where an edge
    # actually existed.
    _forget_feed(blocker, blocked)

    return edge


@transaction.atomic
def unblock(*, blocker: User, blocked: User) -> None:
    """Unblock. Does **not** restore the follows that blocking severed.

    Restoring them would silently re-expose content to someone the user had
    deliberately cut off. If they want to follow again, they can.
    """
    Block.objects.filter(blocker=blocker, blocked=blocked).delete()
    # No follows come back, but both feeds were filtered by the block and are
    # no longer filtered — the *contents* change even though the edges do not.
    _forget_feed(blocker, blocked)


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
    avatar_media_id: str | None = None,
) -> User:
    """Change a profile. `None` means "not mentioned", not "clear it".

    `avatar_media_id=""` is how clearing is expressed, because a PATCH that
    omits a field must leave it alone and there is no other way to say
    "remove".
    """
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

    if avatar_media_id is not None:
        user.avatar_media = _own_ready_media(user, avatar_media_id)
        fields.append("avatar_media")

    if fields:
        user.save(update_fields=fields)
    return user


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------
#
# Django's own `PasswordResetTokenGenerator` rather than a token table, and
# that is worth stating because it looks like a missing model. The token is an
# HMAC over the user's id, their current password hash, their `last_login` and
# a timestamp — so it needs no storage, expires on its own via
# `PASSWORD_RESET_TIMEOUT`, and is invalidated the moment it is used, because
# using it changes the password hash it was derived from. A stolen link
# forwarded to a friend stops working as soon as either of them completes the
# reset. A table would give us all of that plus rows to clean up.


class PasswordResetRejectedError(Exception):
    """The link is wrong, used, or expired. Safe to show a user."""


def request_password_reset(*, email: str) -> None:
    """Mail a reset link, if the address belongs to a live account.

    **Returns nothing, and says nothing, either way.** The view answers 204
    whether or not the address is known — anything else turns this into the
    account-enumeration oracle that `start_session` is careful not to be, and
    an unauthenticated one at that.

    Sent inline rather than through Celery on purpose: the console backend in
    development would otherwise print into the worker's terminal instead of
    the one being watched, and the SMTP call is a few hundred milliseconds on
    an endpoint that is rate-limited to three requests anyway.
    """
    user = User.objects.filter(
        email=User.objects.normalize_email(email.strip()),
        is_active=True,
        deleted_at__isnull=True,
    ).first()
    if user is None:
        return

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    link = f"{settings.FRONTEND_URL}/reset/{uid}/{token}"

    hours = round(settings.PASSWORD_RESET_TIMEOUT / 3600)
    mail.send_mail(
        subject="Reset your Aperture password",
        message=(
            f"Someone asked to reset the password for {user.username}.\n\n"
            f"{link}\n\n"
            f"The link works once and expires in {hours} hours. If this was "
            f"not you, nothing has changed and you can ignore this mail.\n"
        ),
        from_email=None,
        recipient_list=[user.email],
    )


def reset_password(*, uid: str, token: str, password: str) -> User:
    """Complete a reset, and end every session the account had open.

    Signing the other sessions out is the point of a reset as often as not:
    someone resetting a password because it leaked is trying to evict whoever
    has it. Django ties this to `AuthenticationMiddleware`'s session-hash
    check — rotating the password changes the hash, and every session carrying
    the old one fails its next request.
    """
    try:
        pk = int(force_str(urlsafe_base64_decode(uid)))
    except (ValueError, TypeError, DjangoValidationError):
        raise PasswordResetRejectedError("This reset link is not valid.") from None

    user = User.objects.filter(pk=pk, is_active=True, deleted_at__isnull=True).first()
    # Identical message for an unknown user and a bad token, again so this is
    # not an oracle: "no such account" would confirm an address by absence.
    if user is None or not default_token_generator.check_token(user, token):
        raise PasswordResetRejectedError(
            "This reset link has expired or has already been used."
        )

    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        raise PasswordResetRejectedError(" ".join(exc.messages)) from exc

    user.set_password(password)
    user.save(update_fields=["password"])
    return user


def _own_ready_media(user: User, media_id: str) -> Media | None:
    """Resolve an avatar id to a media row, or `None` to clear it.

    **Both checks matter and neither is optional.** Without the ownership
    check anyone could wear someone else's photograph as an avatar by
    guessing an id, which is impersonation with no upload involved. Without
    the `ready` check the avatar would point at a derivative the worker has
    not written yet, and every surface would render a broken image.
    """
    if media_id == "":
        return None

    try:
        pk = int(media_id)
    except ValueError:
        raise ProfileRejectedError("That is not a media id.") from None

    media = Media.objects.filter(
        pk=pk, owner=user, state=Media.State.READY, deleted_at__isnull=True
    ).first()
    if media is None:
        raise ProfileRejectedError("That image is not yours, or is not ready.")
    if media.kind != Media.Kind.IMAGE:
        raise ProfileRejectedError("An avatar has to be a photograph.")
    return media
