"""Writes for the stories app.

Business transactions live here, and this is the only place `.save()` is
called.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from media.models import Media
from stories.models import Story, StoryView
from users.models import User


class StoryRejectedError(Exception):
    """The story cannot be posted. The message is safe to show a user."""


@transaction.atomic
def create_story(*, author: User, media_id: int, caption: str = "") -> Story:
    """Post a story from media that has finished processing.

    The same two checks `posts.create_post` makes, for the same two reasons:
    ownership stops someone attaching a stranger's photograph by guessing an
    id, and `ready` stops a story existing whose derivative the worker has
    not written yet.
    """
    media = Media.objects.filter(
        pk=media_id, owner=author, deleted_at__isnull=True
    ).first()
    if media is None:
        raise StoryRejectedError("That image is not yours.")
    if media.state != Media.State.READY:
        raise StoryRejectedError("That image is still being processed.")

    return Story.objects.create(author=author, media=media, caption=caption[:200])


def mark_viewed(*, story: Story, viewer: User) -> None:
    """Record that someone watched it. Idempotent, and never for the author.

    An author appearing in their own viewer list is noise, and it would also
    make "seen" meaningless on their own tray entry — your own story is
    always yours to have seen.

    The insert races: two tabs open the same story at once. The unique
    constraint decides and the loser is a no-op, which is cheaper and more
    correct than reading first.
    """
    if story.author_id == viewer.pk:
        return
    try:
        # A savepoint, so a duplicate does not abort an enclosing
        # transaction — the mistake this codebase already made once with
        # `client_id` on messages.
        with transaction.atomic():
            StoryView.objects.create(story=story, viewer=viewer)
    except IntegrityError:
        return


def soft_delete_story(*, actor: User, story: Story) -> Story:
    """Take a story down early. Yours only.

    The author check is here rather than only in the view's queryset: a
    service that deletes anybody's story is one careless call site away from
    being a real problem.
    """
    if story.author_id != actor.pk:
        raise StoryRejectedError("You can only delete your own stories.")
    if story.deleted_at is not None:
        return story

    story.deleted_at = timezone.now()
    story.save(update_fields=["deleted_at"])
    return story


def remove_story(*, story: Story) -> Story:
    """Soft-delete with no author check — the moderation queue's entry point.

    Kept apart from `soft_delete_story` for the same reason `remove_message`
    is: resolving a report *is* one person deleting another's content, and
    the unchecked path should have to be reached deliberately.
    """
    if story.deleted_at is not None:
        return story
    story.deleted_at = timezone.now()
    story.save(update_fields=["deleted_at"])
    return story
