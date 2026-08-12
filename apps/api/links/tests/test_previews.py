"""Tests for link previews as they attach to posts and stories.

The fetch itself is not exercised here — that means a network call, and the
decision that matters before one is made is covered in
`core/tests/test_links.py`. What is pinned here is the *caching* behaviour and
the refusal to create a row for a URL the guard would reject.
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from typing import Any

import pytest

from links import services
from links.models import LinkPreview
from posts import services as post_services
from stories import services as story_services
from users.models import User

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Every hostname resolves to a public address unless a test says else."""

    def fake(host: str, port: Any, *args: Any, **kwargs: Any) -> list[Any]:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]

    monkeypatch.setattr(socket, "getaddrinfo", fake)
    yield


class TestResolving:
    def test_a_caption_without_a_link_makes_no_row(self) -> None:
        assert services.preview_for("no links in this one") is None
        assert LinkPreview.objects.count() == 0

    def test_the_same_url_is_one_row(self) -> None:
        first = services.preview_for("see https://example.com/a")
        second = services.preview_for("also https://example.com/a")

        # Ten people sharing an article is one row and one fetch, not ten
        # requests to somebody else's server for the same page.
        assert first is not None
        assert second is not None
        assert first.pk == second.pk
        assert LinkPreview.objects.count() == 1

    def test_an_unfetchable_url_never_becomes_a_row(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def loopback(host: str, port: Any, *args: Any, **kwargs: Any) -> list[Any]:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))]

        monkeypatch.setattr(socket, "getaddrinfo", loopback)

        assert services.preview_for("see https://looks-fine.example/") is None
        assert LinkPreview.objects.count() == 0

    def test_a_bad_scheme_never_becomes_a_row(self) -> None:
        assert services.preview_for("see file:///etc/passwd") is None
        assert LinkPreview.objects.count() == 0


class TestAttaching:
    def test_a_post_carries_the_preview_for_its_caption(self, user: User) -> None:
        from media.models import Media

        media = Media.objects.create(
            owner=user,
            kind=Media.Kind.IMAGE,
            declared_mime="image/jpeg",
            declared_size_bytes=10,
            bucket="media",
            object_key="posts/one.jpg",
            state=Media.State.READY,
        )
        post = post_services.create_post(
            author=user,
            media_ids=[media.pk],
            caption="read this https://example.com/article",
        )

        assert post.link_preview is not None
        assert post.link_preview.url == "https://example.com/article"
        assert post.link_preview.state == LinkPreview.State.PENDING

    def test_a_text_story_carries_one_too(self, user: User) -> None:
        story = story_services.create_story(
            author=user, text="worth reading https://example.com/piece"
        )

        assert story.link_preview is not None
        assert story.link_preview.url == "https://example.com/piece"

    def test_a_post_without_a_link_has_none(self, user: User) -> None:
        from media.models import Media

        media = Media.objects.create(
            owner=user,
            kind=Media.Kind.IMAGE,
            declared_mime="image/jpeg",
            declared_size_bytes=10,
            bucket="media",
            object_key="posts/two.jpg",
            state=Media.State.READY,
        )
        post = post_services.create_post(
            author=user, media_ids=[media.pk], caption="just a photograph"
        )
        assert post.link_preview is None
