"""Writes for the notifications app.

One entry point — `notify` — because every caller wants the same three
things: skip yourself, upsert rather than duplicate, and announce after
commit. Spreading that across seven call sites is how one of them ends up
notifying you about your own like.
"""

from __future__ import annotations

from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from config import broadcast
from notifications.models import Notification
from users.models import User


def notify(
    *,
    recipient: User,
    actor: User,
    verb: str,
    post: Any = None,
    comment: Any = None,
    story: Any = None,
    detail: str = "",
) -> Notification | None:
    """Record something worth telling `recipient` about.

    Returns None when there is nothing to tell — which is not an error and is
    the common case for anything you do to your own content.

    **Announced after commit**, rule 11: a rollback that has already pushed a
    notification has told somebody about a like that does not exist, and the
    badge would stay wrong until they reloaded.
    """
    if recipient.pk == actor.pk:
        # Your own like is not news. Neither is your own comment, and a
        # follow-back notification about yourself is nonsense.
        return None

    try:
        with transaction.atomic():
            row = Notification.objects.create(
                recipient=recipient,
                actor=actor,
                verb=verb,
                post=post,
                comment=comment,
                story=story,
                detail=detail,
            )
    except IntegrityError:
        # Unlike-then-relike, or two tabs. The partial unique constraint
        # decided; the existing row is the right answer and is already newer
        # than anything the recipient has read.
        return Notification.objects.filter(
            recipient=recipient, actor=actor, verb=verb, post=post, comment=None
        ).first()

    recipient_id = recipient.pk
    transaction.on_commit(
        lambda: broadcast.publish_to_users(
            user_ids=[recipient_id],
            event_type="notification.created",
            payload={"verb": verb},
        )
    )
    return row


def withdraw(*, recipient: User, actor: User, verb: str, post: Any = None) -> None:
    """Take one back, because the thing it described stopped being true.

    An unlike removes the notification rather than leaving a tombstone.
    "Ada liked your post" surviving Ada changing her mind is a small lie the
    product has no reason to tell.
    """
    Notification.objects.filter(
        recipient=recipient, actor=actor, verb=verb, post=post
    ).delete()


def mark_all_read(*, user: User) -> int:
    """Clear the badge. Returns how many were still unread."""
    return Notification.objects.filter(recipient=user, read_at__isnull=True).update(
        read_at=timezone.now()
    )
