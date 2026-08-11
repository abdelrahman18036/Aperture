"""Tests for `moderation.services` and account deletion.

The Phase 5 floor, stated as assertions: a report reaches the queue and can be
actioned, and a deleted account's content disappears from every read path.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from media.models import Media
from moderation import selectors, services
from moderation.models import Report
from posts import selectors as post_selectors
from posts import services as post_services
from posts.models import Comment, Post
from users import selectors as user_selectors
from users import services as user_services
from users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture
def moderator(db: object) -> User:
    return User.objects.create_user(
        email="mod@example.com",
        username="mod",
        password="correct-horse-staple",
        is_staff=True,
        is_superuser=True,
    )


def _post(author: User) -> Post:
    return Post.objects.create(author=author, caption="something")


class TestFilingReports:
    def test_a_report_reaches_the_queue(self, user: User, other_user: User) -> None:
        post = _post(other_user)
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.SPAM,
        )
        assert report in list(selectors.queue())
        assert report.subject_owner_id == other_user.pk

    def test_reporting_twice_returns_the_first_report(
        self, user: User, other_user: User
    ) -> None:
        """A brigade of a hundred must not become a hundred queue items."""
        post = _post(other_user)
        first = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.SPAM,
        )
        second = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.HATE,
        )
        assert first.pk == second.pk
        assert selectors.queue().count() == 1

    def test_you_cannot_report_your_own_content(self, user: User) -> None:
        post = _post(user)
        with pytest.raises(services.ReportRejectedError):
            services.file_report(
                reporter=user,
                subject_type=Report.Subject.POST,
                subject_id=post.pk,
                reason=Report.Reason.SPAM,
            )

    def test_reporting_something_that_does_not_exist_is_refused(
        self, user: User
    ) -> None:
        with pytest.raises(services.ReportRejectedError):
            services.file_report(
                reporter=user,
                subject_type=Report.Subject.POST,
                subject_id=999,
                reason=Report.Reason.SPAM,
            )

    def test_a_csam_report_is_flagged_for_escalation(
        self, user: User, other_user: User
    ) -> None:
        post = _post(other_user)
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.CSAM,
        )
        assert report.is_csam
        # Un-escalated until delivery is configured — visibly outstanding
        # rather than silently marked done.
        assert report.escalated_at is None
        assert report in list(selectors.pending_escalations())


class TestResolving:
    def test_dismissing_closes_it_and_leaves_the_content(
        self, user: User, other_user: User, moderator: User
    ) -> None:
        post = _post(other_user)
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.SPAM,
        )
        services.resolve(report=report, moderator=moderator, action="dismiss")

        report.refresh_from_db()
        post.refresh_from_db()
        assert report.status == Report.Status.DISMISSED
        assert post.deleted_at is None
        assert selectors.queue().count() == 0

    def test_removing_soft_deletes_the_post(
        self, user: User, other_user: User, moderator: User
    ) -> None:
        post = _post(other_user)
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.SPAM,
        )
        services.resolve(report=report, moderator=moderator, action="remove")

        post.refresh_from_db()
        assert post.deleted_at is not None
        # Soft, not hard: a moderator acting on a false report needs it back.
        assert Post.objects.filter(pk=post.pk).exists()

    def test_removing_a_comment_soft_deletes_it(
        self, user: User, other_user: User, moderator: User
    ) -> None:
        post = _post(user)
        comment = post_services.add_comment(author=other_user, post=post, body="nasty")
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.COMMENT,
            subject_id=comment.pk,
            reason=Report.Reason.HARASSMENT,
        )
        services.resolve(report=report, moderator=moderator, action="remove")

        comment.refresh_from_db()
        assert comment.deleted_at is not None
        assert Comment.objects.filter(pk=comment.pk).exists()

    def test_suspending_deactivates_the_account(
        self, user: User, other_user: User, moderator: User
    ) -> None:
        post = _post(other_user)
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.HATE,
        )
        services.resolve(report=report, moderator=moderator, action="suspend")

        other_user.refresh_from_db()
        assert not other_user.is_active
        # Suspension is not deletion: no clock toward erasure has started.
        assert other_user.deleted_at is None

    def test_resolving_one_report_resolves_every_duplicate(
        self, user: User, other_user: User, moderator: User
    ) -> None:
        """The queue must not hand a moderator the same decision ten times."""
        third = User.objects.create_user(
            email="c@example.com", username="carol", password="correct-horse-staple"
        )
        post = _post(other_user)
        for reporter in (user, third):
            services.file_report(
                reporter=reporter,
                subject_type=Report.Subject.POST,
                subject_id=post.pk,
                reason=Report.Reason.SPAM,
            )
        assert selectors.queue().count() == 2

        first = selectors.queue().first()
        assert first is not None
        services.resolve(report=first, moderator=moderator, action="remove")

        assert selectors.queue().count() == 0

    def test_resolving_twice_is_a_no_op(
        self, user: User, other_user: User, moderator: User
    ) -> None:
        post = _post(other_user)
        report = services.file_report(
            reporter=user,
            subject_type=Report.Subject.POST,
            subject_id=post.pk,
            reason=Report.Reason.SPAM,
        )
        services.resolve(report=report, moderator=moderator, action="dismiss")
        services.resolve(report=report, moderator=moderator, action="remove")

        post.refresh_from_db()
        report.refresh_from_db()
        assert report.status == Report.Status.DISMISSED
        assert post.deleted_at is None


class TestDeletedAccountsDisappear:
    """§11: a deleted account's content vanishes from every read path."""

    def test_their_posts_leave_the_feed(self, user: User, other_user: User) -> None:
        user_services.follow(follower=user, followee=other_user)
        _post(other_user)
        assert len(list(post_selectors.feed(viewer=user))) == 1

        user_services.delete_account(user=other_user)
        assert list(post_selectors.feed(viewer=user)) == []

    def test_their_contact_sheet_empties(self, user: User, other_user: User) -> None:
        _post(other_user)
        user_services.delete_account(user=other_user)
        assert list(post_selectors.by_author(viewer=user, author=other_user)) == []

    def test_their_posts_cannot_be_fetched_by_id(
        self, user: User, other_user: User
    ) -> None:
        post = _post(other_user)
        user_services.delete_account(user=other_user)
        assert post_selectors.visible_post(viewer=user, post_id=post.pk) is None

    def test_their_comments_disappear(self, user: User, other_user: User) -> None:
        post = _post(user)
        post_services.add_comment(author=other_user, post=post, body="hello")
        assert len(list(post_selectors.comments_for(viewer=user, post=post))) == 1

        user_services.delete_account(user=other_user)
        assert list(post_selectors.comments_for(viewer=user, post=post)) == []

    def test_they_leave_search(self, user: User, other_user: User) -> None:
        assert list(user_selectors.search(viewer=user, query="ada")) == [other_user]
        user_services.delete_account(user=other_user)
        assert list(user_selectors.search(viewer=user, query="ada")) == []

    def test_their_profile_is_gone(self, user: User, other_user: User) -> None:
        user_services.delete_account(user=other_user)
        assert user_selectors.visible_profile(viewer=user, username="ada") is None

    def test_they_cannot_sign_in_again(self, other_user: User) -> None:
        user_services.delete_account(user=other_user)
        assert user_selectors.by_username("ada") is None

    def test_deleting_twice_does_not_move_the_clock(self, user: User) -> None:
        """Otherwise every repeat call postpones the erasure."""
        user_services.delete_account(user=user)
        first = user.deleted_at
        user_services.delete_account(user=user)
        assert user.deleted_at == first

    def test_a_suspended_account_also_disappears(
        self, user: User, other_user: User
    ) -> None:
        """Same read paths, different reason."""
        user_services.follow(follower=user, followee=other_user)
        _post(other_user)
        services.suspend(user=other_user)
        assert list(post_selectors.feed(viewer=user)) == []


class TestHardDelete:
    def test_only_reaps_what_is_past_the_grace_period(
        self, user: User, other_user: User, settings: object
    ) -> None:
        from moderation.tasks import hard_delete_expired

        recent = _post(other_user)
        post_services.soft_delete_post(post=recent)

        old = _post(other_user)
        old.deleted_at = timezone.now() - timedelta(days=365)
        old.save(update_fields=["deleted_at"])

        removed = hard_delete_expired()

        assert removed["posts"] == 1
        assert Post.objects.filter(pk=recent.pk).exists()
        assert not Post.objects.filter(pk=old.pk).exists()

    def test_a_long_deleted_account_is_really_gone(
        self, user: User, fake_storage: dict[str, object]
    ) -> None:
        from moderation.tasks import hard_delete_expired

        Media.objects.create(
            owner=user,
            kind=Media.Kind.IMAGE,
            declared_mime="image/jpeg",
            declared_size_bytes=1,
            bucket="media",
            object_key="x/1/original.jpg",
            state=Media.State.READY,
        )
        user_services.delete_account(user=user)
        user.deleted_at = timezone.now() - timedelta(days=365)
        user.save(update_fields=["deleted_at"])

        removed = hard_delete_expired()

        assert removed["users"] == 1
        assert not User.objects.filter(pk=user.pk).exists()
