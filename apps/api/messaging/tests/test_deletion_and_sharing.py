"""Delete-for-me, and sending a post into a conversation.

The property under test is the one the two deletions differ on: hiding a
message must change nothing for anybody else, and — the part that is easy to
get wrong — it must not put a hole in `seq`, because `seq` is what reconnect
sync walks.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from messaging import selectors, services
from messaging.models import Message
from posts.models import Post
from users.models import User

pytestmark = pytest.mark.django_db


def send(sender: User, conversation: object, body: str) -> Message:
    message, _ = services.send_message(
        sender=sender,
        conversation=conversation,  # type: ignore[arg-type]
        client_id=str(uuid4()),
        body=body,
    )
    return message


@pytest.fixture
def dm(user: User, other_user: User) -> object:
    return services.start_dm(initiator=user, other=other_user)


class TestHideForMe:
    def test_hidden_for_one_person_only(
        self, user: User, other_user: User, dm: object
    ) -> None:
        message = send(other_user, dm, "hello")
        services.hide_message(user=user, message=message)

        mine = selectors.messages_before(conversation=dm, viewer=user)  # type: ignore[arg-type]
        theirs = selectors.messages_before(conversation=dm, viewer=other_user)  # type: ignore[arg-type]
        assert list(mine) == []
        assert [m.pk for m in theirs] == [message.pk]

    def test_leaves_no_gap_in_the_sequence(
        self, user: User, other_user: User, dm: object
    ) -> None:
        first = send(other_user, dm, "one")
        second = send(other_user, dm, "two")
        services.hide_message(user=user, message=first)

        # The row is still there, holding its place. Hiding is a read-side
        # decision; the sequence the other side syncs against is untouched.
        assert Message.objects.filter(pk=first.pk).exists()
        assert second.seq == first.seq + 1

    def test_is_idempotent(self, user: User, other_user: User, dm: object) -> None:
        message = send(other_user, dm, "hello")
        services.hide_message(user=user, message=message)
        services.hide_message(user=user, message=message)
        assert list(selectors.messages_before(conversation=dm, viewer=user)) == []  # type: ignore[arg-type]

    def test_the_inbox_preview_falls_through(
        self, user: User, other_user: User, dm: object
    ) -> None:
        first = send(other_user, dm, "one")
        second = send(other_user, dm, "two")
        services.hide_message(user=user, message=second)

        previews = selectors.last_messages_for(
            conversation_ids=[first.conversation_id], viewer=user
        )
        assert previews[first.conversation_id].pk == first.pk


class TestSharedPost:
    def test_a_post_can_be_the_whole_message(
        self, user: User, other_user: User, dm: object
    ) -> None:
        """A share has no body, and `send_message` must not call that empty."""
        post = Post.objects.create(author=other_user, caption="a photograph")
        message, created = services.send_message(
            sender=user,
            conversation=dm,  # type: ignore[arg-type]
            client_id=str(uuid4()),
            shared_post=post,
        )
        assert created is True
        assert message.shared_post_id == post.pk

    def test_still_refuses_a_message_with_nothing_in_it(
        self, user: User, dm: object
    ) -> None:
        with pytest.raises(services.MessagingRejectedError):
            services.send_message(
                sender=user,
                conversation=dm,  # type: ignore[arg-type]
                client_id=str(uuid4()),
            )
