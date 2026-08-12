"""What happens when the safety providers are actually switched on.

These are the assertions §11 was always asking for and that nothing could
make: with `_match` and `_deliver` raising inline, the *enabled* branch of
both tasks had never executed once. "A match suspends the owner and files a
report" was a claim in a docstring.

The providers are dotted paths now, so a fake one stands in for PhotoDNA and
for the CyberTipline, and everything around them is exercised for real —
which is the whole of this system except the vendor.
"""

from __future__ import annotations

import pytest
from django.test import override_settings

from media.models import Media
from moderation import tasks
from moderation.backends import ProviderNotConfiguredError
from moderation.models import Report
from users.models import User

pytestmark = pytest.mark.django_db

# --- Stand-ins. Module-level, because a dotted path has to import them. -----

MATCHES = "moderation.tests.test_safety_path.always_matches"
CLEAN = "moderation.tests.test_safety_path.never_matches"
BROKEN = "moderation.tests.test_safety_path.raises"

DELIVERS = "moderation.tests.test_safety_path.accepts"
UNDELIVERABLE = "moderation.tests.test_safety_path.rejects"

#: What a fake CyberTipline received, so a test can assert it was reached.
filed: list[int] = []


def always_matches(media: Media) -> bool:
    return True


def never_matches(media: Media) -> bool:
    return False


def raises(media: Media) -> bool:
    raise RuntimeError("the provider is down")


def accepts(report: Report) -> None:
    filed.append(report.pk)


def rejects(report: Report) -> None:
    raise RuntimeError("the CyberTipline refused it")


@pytest.fixture(autouse=True)
def _clear_filed() -> None:
    filed.clear()


def an_image(owner: User) -> Media:
    return Media.objects.create(
        owner=owner,
        kind=Media.Kind.IMAGE,
        declared_mime="image/jpeg",
        declared_size_bytes=1000,
        bucket="media",
        state=Media.State.READY,
    )


class TestScanning:
    def test_it_does_nothing_while_disabled(self, user: User) -> None:
        # The default, and the reason a fake provider is safe to add: with
        # scanning off nothing resolves the backend at all.
        assert tasks.scan_media(an_image(user).pk) == "disabled"

    @override_settings(CSAM_SCANNING_ENABLED=True, CSAM_HASH_BACKEND=MATCHES)
    def test_a_match_suspends_the_owner_and_files_a_report(self, user: User) -> None:
        media = an_image(user)

        assert tasks.scan_media(media.pk) == "matched"

        user.refresh_from_db()
        # Suspended, not deleted: a suspension is a decision that can be
        # reversed, `deleted_at` is the person asking to leave.
        assert user.is_active is False
        assert user.deleted_at is None

        report = Report.objects.get(subject_id=media.pk)
        assert report.reason == Report.Reason.CSAM
        assert report.reporter_id is None
        assert report.subject_owner_id == user.pk

    @override_settings(CSAM_SCANNING_ENABLED=True, CSAM_HASH_BACKEND=CLEAN)
    def test_a_clean_image_is_left_alone(self, user: User) -> None:
        assert tasks.scan_media(an_image(user).pk) == "clean"

        user.refresh_from_db()
        assert user.is_active is True
        assert Report.objects.count() == 0

    @override_settings(CSAM_SCANNING_ENABLED=True, CSAM_HASH_BACKEND=BROKEN)
    def test_a_broken_provider_raises_rather_than_reporting_clean(
        self, user: User
    ) -> None:
        # The most important property here. A scanner that answers "clean"
        # when it is broken is worse than no scanner, because it reports
        # itself as working.
        with pytest.raises(RuntimeError):
            tasks.scan_media(an_image(user).pk)

    @override_settings(CSAM_SCANNING_ENABLED=True)
    def test_the_default_provider_refuses(self, user: User) -> None:
        with pytest.raises(ProviderNotConfiguredError):
            tasks.scan_media(an_image(user).pk)

    def test_video_is_skipped(self, user: User) -> None:
        clip = an_image(user)
        clip.kind = Media.Kind.VIDEO
        clip.save(update_fields=["kind"])
        assert tasks.scan_media(clip.pk) == "skipped"


def a_csam_report(reporter: User, owner: User) -> Report:
    return Report.objects.create(
        reporter=reporter,
        subject_type=Report.Subject.MEDIA,
        subject_id=an_image(owner).pk,
        subject_owner=owner,
        reason=Report.Reason.CSAM,
    )


class TestEscalation:
    def test_it_logs_and_does_not_mark_escalated_while_disabled(
        self, user: User, other_user: User
    ) -> None:
        report = a_csam_report(user, other_user)

        assert tasks.escalate_csam_report(report.pk) == "logged-only"

        report.refresh_from_db()
        # Visibly outstanding. A queue of falsely-escalated reports is an
        # invisible problem; this one is countable.
        assert report.escalated_at is None
        assert filed == []

    @override_settings(NCMEC_REPORTING_ENABLED=True, NCMEC_BACKEND=DELIVERS)
    def test_delivery_marks_it_escalated(self, user: User, other_user: User) -> None:
        report = a_csam_report(user, other_user)

        assert tasks.escalate_csam_report(report.pk) == "escalated"

        report.refresh_from_db()
        assert report.escalated_at is not None
        assert filed == [report.pk]

    @override_settings(NCMEC_REPORTING_ENABLED=True, NCMEC_BACKEND=UNDELIVERABLE)
    def test_a_failed_delivery_leaves_it_unescalated(
        self, user: User, other_user: User
    ) -> None:
        report = a_csam_report(user, other_user)

        with pytest.raises(RuntimeError):
            tasks.escalate_csam_report(report.pk)

        report.refresh_from_db()
        # The ordering that matters: stamped only *after* the provider
        # returns. Stamping first would mark a report filed that was not.
        assert report.escalated_at is None

    @override_settings(NCMEC_REPORTING_ENABLED=True, NCMEC_BACKEND=DELIVERS)
    def test_it_is_filed_once(self, user: User, other_user: User) -> None:
        report = a_csam_report(user, other_user)

        tasks.escalate_csam_report(report.pk)
        assert tasks.escalate_csam_report(report.pk) == "already-escalated"

        # A retry after a successful delivery must not file a second report
        # with a national clearinghouse.
        assert filed == [report.pk]

    @override_settings(NCMEC_REPORTING_ENABLED=True)
    def test_the_default_provider_refuses(self, user: User, other_user: User) -> None:
        report = a_csam_report(user, other_user)

        with pytest.raises(ProviderNotConfiguredError):
            tasks.escalate_csam_report(report.pk)

        report.refresh_from_db()
        assert report.escalated_at is None
