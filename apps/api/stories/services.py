"""Writes for the stories app.

Business transactions live here, and this is the only place `.save()` is
called.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils import timezone

from config import broadcast
from links import services as link_services
from media.models import Media
from stories.models import DEFAULT_BACKGROUND, STORY_BACKGROUNDS, Story, StoryView
from users.models import User


class StoryRejectedError(Exception):
    """The story cannot be posted. The message is safe to show a user."""


@transaction.atomic
def create_story(
    *,
    author: User,
    media_id: int | None = None,
    caption: str = "",
    text: str = "",
    background: str = DEFAULT_BACKGROUND,
) -> Story:
    """Post a story: a picture, a clip, or words on a coloured ground.

    Media is checked the same two ways `posts.create_post` checks it, for the
    same two reasons: ownership stops someone attaching a stranger's
    photograph by guessing an id, and `ready` stops a story existing whose
    derivative the worker has not written yet.

    A text story needs neither, which is the point — the barrier to posting
    one should be having something to say, not having a photograph of it.
    """
    media: Media | None = None
    if media_id is not None:
        media = Media.objects.filter(
            pk=media_id, owner=author, deleted_at__isnull=True
        ).first()
        if media is None:
            raise StoryRejectedError("That image is not yours.")
        if media.state != Media.State.READY:
            raise StoryRejectedError("That image is still being processed.")

    body = text.strip()[:700]
    if media is None and not body:
        raise StoryRejectedError("A story needs a picture or something to say.")

    if background not in STORY_BACKGROUNDS:
        # Falling back rather than refusing: an unknown background is a
        # client that is out of date, and losing somebody's words over a
        # colour name would be the wrong trade.
        background = DEFAULT_BACKGROUND

    story = Story.objects.create(
        author=author,
        media=media,
        text=body,
        background=background,
        caption=caption[:200],
        # A text story is where a link is most likely to be the whole point,
        # so both fields are searched — text first.
        link_preview=link_services.preview_for(f"{body} {caption}"),
    )

    # After commit, so a rollback never announces a story that does not exist
    # — rule 11. Before this the tray only changed on a page load, which is
    # what made a story feel like it had not posted.
    audience = _followers_of(author)
    transaction.on_commit(
        lambda: broadcast.publish_to_users(
            user_ids=audience,
            event_type="story.created",
            payload={"author_id": str(author.pk)},
        )
    )
    return story


def _followers_of(author: User) -> list[int]:
    """Who should hear about this, including the author's own tabs.

    The payload deliberately carries only the author's id rather than the
    story: whoever receives it refetches, which keeps one authorisation path
    — the tray already filters blocks, privacy and expiry, and a payload
    would need all three re-implemented on the wire.
    """
    from users.models import Follow

    ids = list(
        Follow.objects.filter(
            followee=author, status=Follow.Status.ACCEPTED
        ).values_list("follower_id", flat=True)
    )
    ids.append(author.pk)
    return ids


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
