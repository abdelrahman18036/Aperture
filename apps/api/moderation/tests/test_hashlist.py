"""Tests for the hash-list CSAM backend.

This is the first CSAM provider in the tree that actually runs, so what is
pinned here is mostly what it does when something is *wrong*: an absent list,
an empty one, an unset setting. Every one of those has to raise, because a
scanner that answers "clean" because its corpus failed to load reports itself
as working while doing nothing at all.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from django.test import override_settings

from media.models import Media
from moderation import hashlist, tasks
from moderation.backends import ProviderNotConfiguredError
from moderation.models import Report
from users.models import User

pytestmark = pytest.mark.django_db

BACKEND = "moderation.hashlist.match"
KNOWN = b"pretend this is a known file"


@pytest.fixture(autouse=True)
def _forget_cached_lists() -> None:
    """The list is cached by path, and tests reuse paths."""
    hashlist.known_hashes.cache_clear()


@pytest.fixture
def stored_image(user: User, fake_storage: dict[str, Any]) -> Media:
    media = Media.objects.create(
        owner=user,
        kind=Media.Kind.IMAGE,
        declared_mime="image/jpeg",
        declared_size_bytes=len(KNOWN),
        bucket="media",
        object_key="known/file.jpg",
        state=Media.State.READY,
    )
    fake_storage["objects"]["media/known/file.jpg"] = KNOWN
    return media


def a_list(tmp_path: Path, *hashes: str) -> str:
    path = tmp_path / "known-hashes.txt"
    body = "# a comment, and a blank line follow\n\n" + "\n".join(hashes) + "\n"
    path.write_text(body, encoding="utf-8")
    return str(path)


class TestMatching:
    def test_a_listed_file_matches(self, stored_image: Media, tmp_path: Path) -> None:
        digest = hashlib.sha256(KNOWN).hexdigest()
        with override_settings(CSAM_HASH_LIST=a_list(tmp_path, digest)):
            assert hashlist.match(stored_image) is True

    def test_an_unlisted_file_does_not(
        self, stored_image: Media, tmp_path: Path
    ) -> None:
        with override_settings(CSAM_HASH_LIST=a_list(tmp_path, "00" * 32)):
            assert hashlist.match(stored_image) is False

    def test_the_list_is_case_insensitive_and_ignores_comments(
        self, stored_image: Media, tmp_path: Path
    ) -> None:
        digest = hashlib.sha256(KNOWN).hexdigest().upper()
        listing = a_list(tmp_path, f"{digest}  # provenance note")
        with override_settings(CSAM_HASH_LIST=listing):
            assert hashlist.match(stored_image) is True


class TestRefusing:
    def test_an_unset_path_raises(self, stored_image: Media) -> None:
        with (
            override_settings(CSAM_HASH_LIST=""),
            pytest.raises(ProviderNotConfiguredError),
        ):
            hashlist.match(stored_image)

    def test_a_missing_file_raises(self, stored_image: Media) -> None:
        with (
            override_settings(CSAM_HASH_LIST="/nowhere/known-hashes.txt"),
            pytest.raises(ProviderNotConfiguredError),
        ):
            hashlist.match(stored_image)

    def test_an_empty_list_raises(self, stored_image: Media, tmp_path: Path) -> None:
        # The subtlest of the three. An empty list matches nothing, which is
        # indistinguishable from a working scanner finding nothing wrong.
        empty = tmp_path / "empty.txt"
        empty.write_text("# nothing but comments\n", encoding="utf-8")
        with (
            override_settings(CSAM_HASH_LIST=str(empty)),
            pytest.raises(ProviderNotConfiguredError),
        ):
            hashlist.match(stored_image)


class TestThroughTheTask:
    def test_a_match_suspends_and_reports(
        self, stored_image: Media, user: User, tmp_path: Path
    ) -> None:
        """The whole path, with a real provider rather than a fake one."""
        digest = hashlib.sha256(KNOWN).hexdigest()
        with override_settings(
            CSAM_SCANNING_ENABLED=True,
            CSAM_HASH_BACKEND=BACKEND,
            CSAM_HASH_LIST=a_list(tmp_path, digest),
        ):
            assert tasks.scan_media(stored_image.pk) == "matched"

        user.refresh_from_db()
        assert user.is_active is False
        report = Report.objects.get(subject_id=stored_image.pk)
        assert report.reason == Report.Reason.CSAM
        assert report.reporter_id is None

    def test_a_clean_upload_passes(
        self, stored_image: Media, user: User, tmp_path: Path
    ) -> None:
        with override_settings(
            CSAM_SCANNING_ENABLED=True,
            CSAM_HASH_BACKEND=BACKEND,
            CSAM_HASH_LIST=a_list(tmp_path, "11" * 32),
        ):
            assert tasks.scan_media(stored_image.pk) == "clean"

        user.refresh_from_db()
        assert user.is_active is True
        assert Report.objects.count() == 0
