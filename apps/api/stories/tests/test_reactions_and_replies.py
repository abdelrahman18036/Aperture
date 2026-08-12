"""Story reactions and replies.

A reply is a direct message and nothing else — no second inbox, no second
unread count. That is the design decision most worth a test, because the
tempting alternative (a `StoryReply` table) would look reasonable in a diff
and would leave the author with two places to look.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from messaging.models import Message
from notifications.models import Notification
from stories import selectors, services
from stories.models import Story, StoryReaction
from users import services as user_services
from users.models import User

pytestmark = pytest.mark.django_db

HEART = services.REACTIONS[0]
FIRE = services.REACTIONS[1]


@pytest.fixture
def story(other_user: User) -> Story:
    return services.create_story(author=other_user, text="an evening")


class TestReactions:
    def test_reacting_writes_one_row_and_notifies(
        self, user: User, other_user: User, story: Story
    ) -> None:
        services.react(story=story, user=user, emoji=HEART)
        assert StoryReaction.objects.count() == 1
        assert (
            Notification.objects.get(verb=Notification.Verb.STORY_REACTION).detail
            == HEART
        )

    def test_reacting_again_replaces(
        self, user: User, other_user: User, story: Story
    ) -> None:
        services.react(story=story, user=user, emoji=HEART)
        services.react(story=story, user=user, emoji=FIRE)
        assert StoryReaction.objects.count() == 1
        assert StoryReaction.objects.get().emoji == FIRE
        # And the author is told the new thing rather than the old one.
        assert (
            Notification.objects.get(verb=Notification.Verb.STORY_REACTION).detail
            == FIRE
        )

    def test_refuses_an_emoji_that_is_not_on_the_list(
        self, user: User, story: Story
    ) -> None:
        with pytest.raises(services.StoryRejectedError):
            services.react(story=story, user=user, emoji="\U0001f4a9")

    def test_unreacting_removes_the_notification(
        self, user: User, story: Story
    ) -> None:
        services.react(story=story, user=user, emoji=HEART)
        assert services.unreact(story=story, user=user) is True
        assert StoryReaction.objects.count() == 0
        assert Notification.objects.filter(
            verb=Notification.Verb.STORY_REACTION
        ).exists() is False

    def test_unreacting_twice_is_not_an_error(
        self, user: User, story: Story
    ) -> None:
        assert services.unreact(story=story, user=user) is False

    def test_the_viewer_sees_their_own_reaction(
        self, user: User, story: Story
    ) -> None:
        services.react(story=story, user=user, emoji=HEART)
        assert selectors.viewer_reactions(viewer=user, story_ids=[story.pk]) == {
            story.pk: HEART
        }


class TestReplies:
    def test_a_reply_is_a_direct_message(
        self, user: User, other_user: User, story: Story
    ) -> None:
        message = services.reply(
            story=story, user=user, body="beautiful", client_id=str(uuid4())
        )
        assert isinstance(message, Message)
        assert message.body == "beautiful"
        # And it remembers which frame it was about, so the author can tell.
        assert message.replied_story_id == story.pk

    def test_replying_twice_reuses_the_conversation(
        self, user: User, other_user: User, story: Story
    ) -> None:
        first = services.reply(
            story=story, user=user, body="one", client_id=str(uuid4())
        )
        second = services.reply(
            story=story, user=user, body="two", client_id=str(uuid4())
        )
        assert first.conversation_id == second.conversation_id

    def test_refuses_an_empty_reply(self, user: User, story: Story) -> None:
        with pytest.raises(services.StoryRejectedError):
            services.reply(story=story, user=user, body="   ", client_id=str(uuid4()))

    def test_refuses_your_own_story(self, user: User) -> None:
        mine = services.create_story(author=user, text="mine")
        with pytest.raises(services.StoryRejectedError):
            services.reply(story=mine, user=user, body="hi", client_id=str(uuid4()))

    def test_a_block_still_stops_the_message(
        self, user: User, other_user: User, story: Story
    ) -> None:
        """The reply path must not be a way around a block."""
        from messaging.services import MessagingRejectedError

        user_services.block(blocker=other_user, blocked=user)
        with pytest.raises(MessagingRejectedError):
            services.reply(story=story, user=user, body="hi", client_id=str(uuid4()))
