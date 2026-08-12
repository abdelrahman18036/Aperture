"""Finding links in text, and deciding which ones we are willing to fetch.

Pure Python, no Django — rule 5. The network call itself lives in
`links/tasks.py`; everything here is the part that has to be right before a
socket is opened, and it is unit-testable in milliseconds.

**This module exists because fetching a user-supplied URL from a server is an
SSRF primitive.** Somebody posts `http://169.254.169.254/latest/meta-data/`
and the preview card renders the cloud instance's credentials; somebody posts
`http://localhost:9000/` and it renders whatever object storage says. The
mitigations are not optional and not a nice-to-have:

- scheme allowlist, so `file://` and `gopher://` never reach a fetcher
- a DNS resolution *before* the request, and a rejection of every private,
  loopback, link-local, multicast and reserved address the name resolves to
- the same check applied again after each redirect, because a public host is
  free to redirect to `127.0.0.1`

Nothing here trusts the URL's shape. `http://127.0.0.1.nip.io/` looks public
and resolves to loopback, which is exactly why the check is on the resolved
address and not on the text.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

#: Only these two ever get fetched.
ALLOWED_SCHEMES = frozenset({"http", "https"})

#: Deliberately loose about the tail — trailing punctuation is trimmed after
#: matching, because "see https://example.com." ends a sentence far more often
#: than it names a host with a dot on the end.
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)

#: Characters that end a sentence rather than a URL.
TRAILING = ".,;:!?)]}'\""


class UnsafeUrlError(ValueError):
    """The URL must not be fetched. The message is for a log, not a user."""


@dataclass(frozen=True, slots=True)
class Preview:
    """What a fetch produced. Every field optional but the URL."""

    url: str
    title: str = ""
    description: str = ""
    image_url: str = ""
    site_name: str = ""

    @property
    def is_useful(self) -> bool:
        """A card with no title and no image is worse than no card."""
        return bool(self.title or self.image_url)


def first_url(text: str) -> str | None:
    """The first link in a caption, or None.

    One per post. A caption with six links is a caption, not six cards, and
    the surface only has room for the thing the writer led with.
    """
    match = URL_PATTERN.search(text or "")
    if match is None:
        return None
    return match.group(0).rstrip(TRAILING) or None


def _is_public(address: str) -> bool:
    """Whether an IP is one we are willing to open a connection to."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_fetchable(url: str) -> None:
    """Raise unless this URL is safe to request. Called before every hop.

    Resolution happens here rather than being left to the HTTP client,
    because the client would happily connect to whatever the name resolves
    to — and the whole attack is a public-looking name that resolves to a
    private address.

    A name that resolves to *several* addresses must have **all** of them
    public. Accepting on the first public answer leaves a DNS round-robin
    with one loopback entry as a way through.
    """
    parts = urlsplit(url)

    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeUrlError(f"scheme {parts.scheme!r} is not fetchable")
    if not parts.hostname:
        raise UnsafeUrlError("no host")

    try:
        resolved = socket.getaddrinfo(parts.hostname, parts.port or 80)
    except socket.gaierror as exc:
        raise UnsafeUrlError(f"{parts.hostname!r} does not resolve") from exc

    # `sockaddr[0]` is the address for both v4 and v6; typed loosely by the
    # stdlib because the tuple shape differs between families.
    addresses = {str(info[4][0]) for info in resolved}
    if not addresses:
        raise UnsafeUrlError(f"{parts.hostname!r} resolved to nothing")

    for address in addresses:
        if not _is_public(address):
            raise UnsafeUrlError(
                f"{parts.hostname!r} resolves to {address}, which is not public"
            )
