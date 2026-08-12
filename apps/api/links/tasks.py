"""Fetching a link preview, carefully.

**Every constraint here is a mitigation, not a preference.** Fetching a URL a
stranger supplied, from a server inside our network, is an SSRF primitive —
see `core/links.py` for the guard and what it is guarding against. This module
adds the rest:

- **The guard runs on every hop.** A public host is free to redirect to
  `127.0.0.1`, so `assert_fetchable` is called again for each redirect target
  rather than once at the start.
- **A byte ceiling.** The response is read in chunks up to `MAX_BYTES` and
  then abandoned. Without it, a URL pointing at a 4GB file is a way to fill
  the worker's memory from a caption.
- **A timeout, and few redirects.** Both bound how long one caption can tie
  up a worker.
- **HTML only.** A `content-type` that is not HTML is not parsed; whatever it
  is, it is not Open Graph tags.

It runs on the queue, never on the request path — publishing a post must not
wait on somebody else's server being slow.
"""

from __future__ import annotations

import logging
import urllib.request
from html.parser import HTMLParser
from typing import Any
from urllib.error import URLError

from celery import shared_task
from django.utils import timezone

from core.links import Preview, UnsafeUrlError, assert_fetchable
from links.models import LinkPreview

logger = logging.getLogger(__name__)

#: Open Graph tags live in `<head>`. 512KB reaches it on any sane page and
#: refuses to keep reading a document that is mostly body.
MAX_BYTES = 512 * 1024
TIMEOUT_SECONDS = 6
MAX_REDIRECTS = 3

#: Honest rather than a browser string. A site that would rather not be
#: fetched by a bot can act on this.
USER_AGENT = "Aperture/1.0 (+link preview; one request per URL)"


class _OpenGraph(HTMLParser):
    """Just enough HTML parsing to read `<meta>` out of `<head>`.

    Stops at `</head>`: everything wanted is above it, and parsing a whole
    page to find tags that are not there is work for nothing.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: dict[str, str] = {}
        self.title = ""
        self.done = False
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.done:
            return
        if tag == "title":
            self._in_title = True
            return
        if tag != "meta":
            return

        pairs = dict(attrs)
        # `property` is Open Graph, `name` is the older convention. Twitter
        # cards use `name` and are a useful fallback on sites that have them
        # and no OG tags.
        key = (pairs.get("property") or pairs.get("name") or "").lower()
        value = pairs.get("content") or ""
        if key and value:
            self.tags.setdefault(key, value)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag == "head":
            self.done = True

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.title:
            self.title = data.strip()


class _GuardedRedirects(urllib.request.HTTPRedirectHandler):
    """Re-checks every redirect target before following it.

    The reason this class exists: a URL that passes the guard can answer 302
    to `http://169.254.169.254/`, and a client that only checked the first
    hop would follow it happily.
    """

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        assert_fetchable(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _read(url: str) -> str:
    """Fetch and return at most `MAX_BYTES` of HTML."""
    assert_fetchable(url)

    opener = urllib.request.build_opener(_GuardedRedirects())
    request = urllib.request.Request(  # noqa: S310 - scheme checked by the guard
        url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}
    )

    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
        content_type = response.headers.get("content-type", "")
        if "html" not in content_type.lower():
            return ""
        raw = response.read(MAX_BYTES)

    charset: str = response.headers.get_content_charset() or "utf-8"
    decoded: str = raw.decode(charset, errors="replace")
    return decoded


def _extract(url: str, html: str) -> Preview:
    parser = _OpenGraph()
    parser.feed(html)
    tags = parser.tags

    def first(*keys: str) -> str:
        for key in keys:
            if tags.get(key):
                return tags[key].strip()
        return ""

    return Preview(
        url=url,
        # Open Graph, then Twitter, then the `<title>` element. Capped to the
        # column widths, because these are somebody else's strings.
        title=(first("og:title", "twitter:title") or parser.title)[:300],
        description=first("og:description", "twitter:description", "description")[:600],
        image_url=first("og:image", "og:image:url", "twitter:image")[:1000],
        site_name=first("og:site_name")[:120],
    )


@shared_task(name="links.fetch_preview")
def fetch_preview(preview_id: int) -> str:
    """Fill in one `LinkPreview`. Never raises past the queue.

    A failure is recorded as `failed` rather than retried forever: the row
    exists so the same URL is not re-fetched by every post that mentions it,
    and that reasoning applies just as much to a URL that does not work.
    """
    row = LinkPreview.objects.filter(pk=preview_id).first()
    if row is None:
        return "missing"
    if row.state != LinkPreview.State.PENDING:
        return "already-fetched"

    try:
        preview = _extract(row.url, _read(row.url))
    except UnsafeUrlError as exc:
        logger.info("refused link preview for %s: %s", row.url[:120], exc)
        preview = None
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        logger.info("link preview failed for %s: %s", row.url[:120], exc)
        preview = None

    row.fetched_at = timezone.now()
    if preview is None or not preview.is_useful:
        # A card with no title and no image is worse than no card, so a page
        # that yields nothing is a failure rather than an empty success.
        row.state = LinkPreview.State.FAILED
        row.save(update_fields=["state", "fetched_at"])
        return "failed"

    row.title = preview.title
    row.description = preview.description
    row.image_url = preview.image_url
    row.site_name = preview.site_name
    row.state = LinkPreview.State.READY
    row.save(
        update_fields=[
            "title",
            "description",
            "image_url",
            "site_name",
            "state",
            "fetched_at",
        ]
    )
    return "ready"
