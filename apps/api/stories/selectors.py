"""Reads for the stories app.

**Rule 8 lives in `live()`.** Every read path here starts from it, so a
blocked account's stories are absent from the tray, from a profile and from a
direct fetch by id without any of the three remembering to filter. That is
the point of putting it in the base selector rather than in each view.

Two things are filtered together and are not the same: `expires_at` is
whether the story still exists, and blocking is whether you may see it.
"""

from __future__ import annotations

from django.db.models import QuerySet
from django.utils import timezone

from stories.models import Story, StoryView
from users.models import Follow, User
from users.selectors import exclude_blocked


def live(viewer: User | None) -> QuerySet[Story]:
    """Stories that exist, from accounts this viewer may see.

    `select_related` on the author and their avatar because a tray renders
    both for every entry — without it the tray is an N+1 in the exact shape
    rule 10 asks to be looked for.
    """
    queryset = (
        Story.objects.filter(
            deleted_at__isnull=True,
            expires_at__gt=timezone.now(),
            author__deleted_at__isnull=True,
            author__is_active=True,
        )
        .select_related("author", "author__avatar_media", "media", "link_preview")
        .order_by("id")
    )
    if viewer is None:
        return queryset
    return exclude_blocked(queryset, viewer=viewer, author_field="author_id")


def visible_to(viewer: User) -> QuerySet[Story]:
    """The tray: your own stories plus those of accounts you follow.

    A private account's stories follow the same rule its posts do — you see
    them if the follow was accepted. Public accounts are visible to their
    followers only *here*, deliberately: a story is a day, not a portfolio,
    and a discovery surface full of strangers' days is a different product.
    """
    followee_ids = Follow.objects.filter(
        follower=viewer, status=Follow.Status.ACCEPTED
    ).values_list("followee_id", flat=True)

    return live(viewer).filter(author_id__in=[viewer.pk, *followee_ids])


def by_author(*, viewer: User, author: User) -> QuerySet[Story]:
    """One person's live stories, oldest first — the order they are watched."""
    return live(viewer).filter(author=author)


def seen_ids(*, viewer: User, story_ids: list[int]) -> set[int]:
    """Which of these the viewer has already watched.

    Batched. One query for a whole tray rather than one per author, which is
    the same N+1 in a different coat.
    """
    if not story_ids:
        return set()
    return set(
        StoryView.objects.filter(viewer=viewer, story_id__in=story_ids).values_list(
            "story_id", flat=True
        )
    )


#: The viewer list is a peek, not a report. A story on a popular account is
#: read by everyone who follows it, and an unbounded list would be tens of
#: thousands of rows serialised into a panel nobody scrolls — the same
#: mistake `pending_requests_for` made with 315 follow requests.
VIEWER_PAGE = 100


def viewers_of(story: Story, *, limit: int = VIEWER_PAGE) -> QuerySet[StoryView]:
    """Who has watched it, newest first. For the author only, and bounded."""
    return (
        StoryView.objects.filter(story=story)
        .select_related("viewer", "viewer__avatar_media")
        .order_by("-id")[:limit]
    )
