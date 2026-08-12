"""Tests for link extraction and the SSRF guard.

No database and no network. `assert_fetchable` resolves DNS, so the tests
that need a specific answer patch the resolver — the point is the *decision*,
not whether this machine can reach the internet.

The guard is the interesting half. Everything it refuses is something that
would otherwise turn "paste a link in a caption" into a way to make our
server fetch a URL of somebody else's choosing from inside our network.
"""

from __future__ import annotations

import socket
from collections.abc import Iterator
from typing import Any

import pytest

from core.links import (
    Preview,
    UnsafeUrlError,
    assert_fetchable,
    first_url,
)


@pytest.fixture
def resolves_to(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    """Point every hostname at addresses of the test's choosing."""

    def install(*addresses: str) -> None:
        def fake(host: str, port: Any, *args: Any, **kwargs: Any) -> list[Any]:
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port or 80))
                for address in addresses
            ]

        monkeypatch.setattr(socket, "getaddrinfo", fake)

    yield install


class TestFindingLinks:
    def test_it_finds_the_first(self) -> None:
        caption = "shot on https://example.com/a and https://example.com/b"
        assert first_url(caption) == "https://example.com/a"

    def test_it_trims_sentence_punctuation(self) -> None:
        # "see https://example.com." ends a sentence far more often than it
        # names a host with a dot on the end.
        assert first_url("see https://example.com.") == "https://example.com"
        assert first_url("(https://example.com/x)") == "https://example.com/x"

    def test_text_without_a_link_has_none(self) -> None:
        assert first_url("no links here") is None
        assert first_url("") is None

    def test_a_bare_domain_is_not_a_link(self) -> None:
        # Requiring a scheme keeps "shot at f/1.8 on 35mm" out of the fetcher.
        assert first_url("shot at f/1.8 on 35mm") is None


class TestTheGuard:
    def test_a_public_address_is_allowed(self, resolves_to: Any) -> None:
        resolves_to("93.184.216.34")
        assert_fetchable("https://example.com/a")

    @pytest.mark.parametrize(
        "address",
        [
            "127.0.0.1",  # loopback
            "10.0.0.5",  # private
            "192.168.1.1",  # private
            "172.16.0.9",  # private
            "169.254.169.254",  # link-local: the cloud metadata endpoint
            "0.0.0.0",  # noqa: S104 - unspecified, and the point of the test
            "224.0.0.1",  # multicast
        ],
    )
    def test_private_addresses_are_refused(
        self, resolves_to: Any, address: str
    ) -> None:
        resolves_to(address)
        with pytest.raises(UnsafeUrlError):
            assert_fetchable("https://looks-public.example/")

    def test_a_public_name_resolving_to_loopback_is_refused(
        self, resolves_to: Any
    ) -> None:
        """The attack the guard exists for.

        `http://127.0.0.1.nip.io/` is a perfectly ordinary-looking hostname
        that resolves to loopback, which is why the check is on the resolved
        address and never on the text of the URL.
        """
        resolves_to("127.0.0.1")
        with pytest.raises(UnsafeUrlError):
            assert_fetchable("https://127-0-0-1.nip.io/")

    def test_one_private_answer_among_several_is_enough_to_refuse(
        self, resolves_to: Any
    ) -> None:
        # A round-robin with one loopback entry would otherwise be a way
        # through on whichever request happened to pick it.
        resolves_to("93.184.216.34", "127.0.0.1")
        with pytest.raises(UnsafeUrlError):
            assert_fetchable("https://example.com/")

    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "gopher://example.com/",
            "ftp://example.com/",
            "data:text/html,hello",
        ],
    )
    def test_other_schemes_never_reach_a_fetcher(self, url: str) -> None:
        with pytest.raises(UnsafeUrlError):
            assert_fetchable(url)

    def test_a_name_that_does_not_resolve_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def boom(*args: Any, **kwargs: Any) -> list[Any]:
            raise socket.gaierror("nope")

        monkeypatch.setattr(socket, "getaddrinfo", boom)
        with pytest.raises(UnsafeUrlError):
            assert_fetchable("https://nowhere.invalid/")


class TestUsefulness:
    def test_a_card_with_nothing_on_it_is_not_worth_showing(self) -> None:
        assert Preview(url="https://example.com").is_useful is False
        assert Preview(url="https://example.com", title="A title").is_useful
        assert Preview(
            url="https://example.com", image_url="https://example.com/i.jpg"
        ).is_useful
