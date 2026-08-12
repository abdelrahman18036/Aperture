"""Answering every pending follow request at once.

The bulk path is a second implementation of a decision the singular one
already makes, so what these pin is that the two agree: same edge states, same
counter movement, same notifications withdrawn. A bulk action that drifts from
its singular twin is worse than not having one.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from notifications.models import Notification
from users import services
from users.models import Follow, User

pytestmark = pytest.mark.django_db


@pytest.fixture
def private(user: User) -> User:
    user.is_private = True
    user.save(update_fields=["is_private"])
    return user


@pytest.fixture
def askers(db: object) -> list[User]:
    return [
        User.objects.create_user(
            email=f"asker{index}@example.com",
            username=f"asker{index}",
            password="correct-horse-staple",
        )
        for index in range(3)
    ]


def ask(askers: list[User], private: User) -> None:
    for asker in askers:
        services.follow(follower=asker, followee=private)


class TestApproveAll:
    def test_every_pending_edge_becomes_accepted(
        self, private: User, askers: list[User]
    ) -> None:
        ask(askers, private)
        assert services.respond_to_all_requests(followee=private, accept=True) == 3
        assert (
            Follow.objects.filter(
                followee=private, status=Follow.Status.ACCEPTED
            ).count()
            == 3
        )
        assert not Follow.objects.filter(status=Follow.Status.PENDING).exists()

    def test_the_asks_stop_asking(self, private: User, askers: list[User]) -> None:
        """A request notification outliving the request is a queue that lies."""
        ask(askers, private)
        assert (
            Notification.objects.filter(verb=Notification.Verb.FOLLOW_REQUEST).count()
            == 3
        )

        services.respond_to_all_requests(followee=private, accept=True)
        assert not Notification.objects.filter(
            verb=Notification.Verb.FOLLOW_REQUEST
        ).exists()

    def test_an_empty_queue_is_not_an_error(self, private: User) -> None:
        assert services.respond_to_all_requests(followee=private, accept=True) == 0

    def test_only_pending_edges_are_touched(
        self, private: User, askers: list[User], other_user: User
    ) -> None:
        """Somebody already following must not be re-accepted and re-counted."""
        ask(askers, private)
        services.follow(follower=other_user, followee=private)
        services.respond_to_request(followee=private, follower=other_user, accept=True)

        assert services.respond_to_all_requests(followee=private, accept=True) == 3


class TestDeclineAll:
    def test_every_pending_edge_is_removed(
        self, private: User, askers: list[User]
    ) -> None:
        ask(askers, private)
        assert services.respond_to_all_requests(followee=private, accept=False) == 3
        assert not Follow.objects.filter(followee=private).exists()
        assert not Notification.objects.filter(
            verb=Notification.Verb.FOLLOW_REQUEST
        ).exists()

    def test_declining_leaves_nothing_behind_so_asking_again_works(
        self, private: User, askers: list[User]
    ) -> None:
        ask(askers, private)
        services.respond_to_all_requests(followee=private, accept=False)

        services.follow(follower=askers[0], followee=private)
        assert (
            Follow.objects.filter(
                followee=private, status=Follow.Status.PENDING
            ).count()
            == 1
        )


class TestEndpoint:
    def test_answers_and_reports_how_many(
        self, api: APIClient, private: User, askers: list[User]
    ) -> None:
        ask(askers, private)
        api.force_authenticate(user=private)

        response = api.post(
            "/api/users/requests/respond-all", {"accept": True}, format="json"
        )
        assert response.status_code == 200
        assert response.json() == {"answered": 3}

    def test_needs_a_session(self, api: APIClient) -> None:
        response = api.post(
            "/api/users/requests/respond-all", {"accept": True}, format="json"
        )
        assert response.status_code == 403

    def test_the_literal_route_is_not_read_as_a_username(
        self, api: APIClient, private: User
    ) -> None:
        """`requests/respond-all` must not resolve as a profile named `requests`."""
        api.force_authenticate(user=private)
        response = api.post(
            "/api/users/requests/respond-all", {"accept": False}, format="json"
        )
        assert response.status_code == 200
