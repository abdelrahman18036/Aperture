"""Tests for stories.

Two things carry the weight here and neither is the happy path: expiry has to
be a *read* filter rather than a scheduled flag, and rule 8 has to hold on
every one of these paths rather than on the one that was remembered.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from media.models import Media
from stories import selectors, services, tasks
from stories.models import Story, StoryView
from users.models import Block, Follow, User

pytestmark = pytest.mark.django_db


def an_image(owner: User, *, state: str = Media.State.READY) -> Media:
    # A distinct `object_key` per row: `(bucket, object_key)` is unique, so
    # leaving it blank means the second image in any test collides.
    return Media.objects.create(
        owner=owner,
        kind=Media.Kind.IMAGE,
        declared_mime="image/jpeg",
        declared_size_bytes=1000,
        bucket="media",
        object_key=f"test/{uuid4().hex}.jpg",
        state=state,
    )


def a_story(author: User, **kwargs: object) -> Story:
    return Story.objects.create(author=author, media=an_image(author), **kwargs)


def follows(follower: User, followee: User) -> None:
    Follow.objects.create(
        follower=follower, followee=followee, status=Follow.Status.ACCEPTED
    )


class TestPosting:
    def test_your_own_ready_image_is_accepted(self, user: User) -> None:
        media = an_image(user)
        story = services.create_story(author=user, media_id=media.pk, caption="hello")
        assert story.media_id == media.pk
        assert story.is_live

    def test_somebody_else_s_image_is_refused(
        self, user: User, other_user: User
    ) -> None:
        theirs = an_image(other_user)
        with pytest.raises(services.StoryRejectedError):
            services.create_story(author=user, media_id=theirs.pk)

    def test_an_unprocessed_image_is_refused(self, user: User) -> None:
        pending = an_image(user, state=Media.State.PENDING)
        with pytest.raises(services.StoryRejectedError):
            services.create_story(author=user, media_id=pending.pk)

    def test_it_expires_in_a_day(self, user: User) -> None:
        story = services.create_story(author=user, media_id=an_image(user).pk)
        remaining = story.expires_at - timezone.now()
        assert timedelta(hours=23) < remaining <= timedelta(hours=24)


class TestExpiry:
    def test_a_lapsed_story_leaves_every_read_immediately(
        self, user: User, other_user: User
    ) -> None:
        """The property the whole design rests on.

        Expiry is a column every read filters on, not a flag a worker flips.
        If it were the latter there would be a window — however short —
        where a story someone expected to be gone is still being served, and
        that window is precisely what they were trusting us not to have.
        """
        follows(other_user, user)
        story = a_story(user, expires_at=timezone.now() - timedelta(seconds=1))

        assert story not in list(selectors.visible_to(other_user))
        assert story not in list(selectors.by_author(viewer=other_user, author=user))
        assert selectors.live(other_user).filter(pk=story.pk).first() is None
        # And nothing ran. No task, no flag.
        story.refresh_from_db()
        assert story.deleted_at is None

    def test_the_reaper_only_touches_what_has_long_lapsed(self, user: User) -> None:
        fresh = a_story(user)
        recent = a_story(user, expires_at=timezone.now() - timedelta(hours=1))
        old = a_story(user, expires_at=timezone.now() - timedelta(hours=30))

        assert tasks.reap_expired() == 1

        for story, expected in ((fresh, None), (recent, None)):
            story.refresh_from_db()
            assert story.deleted_at is expected
        old.refresh_from_db()
        assert old.deleted_at is not None


class TestWhoCanSee:
    def test_the_tray_holds_your_own_and_the_people_you_follow(
        self, user: User, other_user: User
    ) -> None:
        follows(user, other_user)
        mine = a_story(user)
        theirs = a_story(other_user)

        stories = list(selectors.visible_to(user))

        assert mine in stories
        assert theirs in stories

    def test_a_stranger_is_not_in_the_tray(self, user: User, other_user: User) -> None:
        # A story is a day rather than a portfolio. A tray full of strangers'
        # days is a different product, so this is deliberate, not an omission.
        a_story(other_user)
        assert list(selectors.visible_to(user)) == []

    def test_blocking_hides_stories_both_ways(
        self, user: User, other_user: User
    ) -> None:
        """Rule 8, on this app's base selector rather than in its views."""
        follows(user, other_user)
        follows(other_user, user)
        a_story(other_user)
        a_story(user)
        Block.objects.create(blocker=user, blocked=other_user)

        assert list(selectors.visible_to(user)) == [
            story for story in selectors.visible_to(user) if story.author_id == user.pk
        ]
        assert not any(
            story.author_id == other_user.pk for story in selectors.visible_to(user)
        )
        assert not any(
            story.author_id == user.pk for story in selectors.visible_to(other_user)
        )

    def test_a_deleted_account_takes_its_stories_with_it(
        self, user: User, other_user: User
    ) -> None:
        follows(user, other_user)
        a_story(other_user)
        other_user.deleted_at = timezone.now()
        other_user.is_active = False
        other_user.save(update_fields=["deleted_at", "is_active"])

        assert list(selectors.visible_to(user)) == []


class TestWatching:
    def test_watching_is_recorded_once(self, user: User, other_user: User) -> None:
        story = a_story(other_user)

        services.mark_viewed(story=story, viewer=user)
        services.mark_viewed(story=story, viewer=user)

        assert StoryView.objects.filter(story=story).count() == 1

    def test_an_author_does_not_view_their_own(self, user: User) -> None:
        story = a_story(user)
        services.mark_viewed(story=story, viewer=user)
        assert StoryView.objects.filter(story=story).count() == 0


class TestTheApi:
    def test_the_tray_marks_unseen_first(
        self, signed_in: APIClient, user: User, other_user: User
    ) -> None:
        follows(user, other_user)
        a_story(other_user)
        a_story(user)

        entries = signed_in.get("/api/stories/tray").json()

        assert [entry["author"]["username"] for entry in entries] == [
            other_user.username,
            user.username,
        ]
        assert entries[0]["all_seen"] is False
        # Your own is never "unwatched" — you posted it.
        assert entries[1]["all_seen"] is True

    def test_watching_moves_it_down_the_tray(
        self, signed_in: APIClient, user: User, other_user: User
    ) -> None:
        follows(user, other_user)
        story = a_story(other_user)

        assert signed_in.post(f"/api/stories/{story.pk}").status_code == 204

        entries = signed_in.get("/api/stories/tray").json()
        assert entries[0]["all_seen"] is True

    def test_you_cannot_delete_somebody_else_s(
        self, signed_in: APIClient, other_user: User
    ) -> None:
        story = a_story(other_user)
        # 404, not 403: a refused delete must not confirm the story exists.
        assert signed_in.delete(f"/api/stories/{story.pk}").status_code == 404
        story.refresh_from_db()
        assert story.deleted_at is None

    def test_the_viewer_list_is_the_author_s_alone(
        self, signed_in: APIClient, user: User, other_user: User
    ) -> None:
        theirs = a_story(other_user)
        assert signed_in.get(f"/api/stories/{theirs.pk}/viewers").status_code == 404

        mine = a_story(user)
        services.mark_viewed(story=mine, viewer=other_user)
        rows = signed_in.get(f"/api/stories/{mine.pk}/viewers").json()
        assert [row["viewer"]["username"] for row in rows] == [other_user.username]

    def test_an_expired_story_is_a_404(
        self, signed_in: APIClient, other_user: User
    ) -> None:
        story = a_story(other_user, expires_at=timezone.now() - timedelta(seconds=1))
        assert signed_in.post(f"/api/stories/{story.pk}").status_code == 404


class TestTextStories:
    """Words on a coloured ground, with no photograph at all.

    The barrier to posting a story should be having something to say, not
    having a picture of it — so media is optional and the model's check
    constraint is what stops the empty case rather than a service that a
    future call site could route around.
    """

    def test_words_alone_are_a_story(self, user: User) -> None:
        story = services.create_story(
            author=user, text="Just got the enlarger working.", background="moss"
        )

        assert story.media_id is None
        assert story.background == "moss"
        assert story.is_live

    def test_neither_is_refused(self, user: User) -> None:
        with pytest.raises(services.StoryRejectedError):
            services.create_story(author=user, text="   ")

    def test_an_unknown_background_falls_back(self, user: User) -> None:
        # Losing somebody's words over a colour name would be the wrong
        # trade: an unrecognised background is an out-of-date client.
        story = services.create_story(
            author=user, text="Hello", background="chartreuse"
        )
        assert story.background == "slate"

    def test_the_database_refuses_an_empty_story(self, user: User) -> None:
        from django.db import IntegrityError, transaction

        # Straight past the service, which is the point of the constraint.
        with pytest.raises(IntegrityError), transaction.atomic():
            Story.objects.create(author=user, media=None, text="")

    def test_the_api_takes_text_and_gives_back_css(
        self, signed_in: APIClient, user: User
    ) -> None:
        response = signed_in.post(
            "/api/stories/create",
            {"text": "Fixed the leak in the tank.", "background": "clay"},
            format="json",
        )

        assert response.status_code == 201
        body = response.json()
        assert body["media"] is None
        assert body["text"] == "Fixed the leak in the tank."
        # Resolved server-side, so adding a background later is a server
        # change alone.
        assert body["background_css"].startswith("linear-gradient")
