"""Reads for the calls app.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly -- that is what makes the block-filtering audit in
`01-ARCHITECTURE.md` §11 a one-file job instead of a forty-view job.

No `.count()` and no `COUNT(*)` on anything a request can reach: use the
`counters` table, cached in Redis.

Calls own no tables, so the only read here is "may this person call into that
conversation" — which is a messaging question, asked from the calls app.
"""

from __future__ import annotations

from messaging.models import Conversation
from messaging.selectors import membership_or_none
from users.models import User


def callable_conversation(*, user: User, conversation_id: int) -> Conversation | None:
    """The conversation, if this user is in it. Otherwise None.

    Deliberately reuses `messaging.selectors.membership_or_none` rather than
    writing a second membership query. Two implementations of "is this person
    in this conversation" is exactly how one of them ends up wrong.
    """
    member = membership_or_none(user=user, conversation_id=conversation_id)
    return None if member is None else member.conversation
