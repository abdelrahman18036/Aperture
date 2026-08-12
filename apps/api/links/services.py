"""Writes for the links app."""

from __future__ import annotations

from django.db import IntegrityError, transaction

from core.links import UnsafeUrlError, assert_fetchable, first_url
from links.models import LinkPreview


def preview_for(text: str) -> LinkPreview | None:
    """The preview row for the first link in some text, creating it if new.

    Returns None when there is no link, or when the link is one we will not
    fetch — the guard runs here as well as in the task so an unfetchable URL
    never becomes a row at all.

    Enqueues after commit, never inside the transaction. A rolled-back post
    that already queued a fetch would send a request on behalf of a post that
    does not exist — rule 11, and the same reasoning as publishing to Redis.
    """
    url = first_url(text)
    if url is None:
        return None

    try:
        assert_fetchable(url)
    except UnsafeUrlError:
        return None

    digest = LinkPreview.hash_for(url)
    existing = LinkPreview.objects.filter(url_hash=digest).first()
    if existing is not None:
        # Ten people sharing one article is one row and one fetch.
        return existing

    try:
        with transaction.atomic():
            row = LinkPreview.objects.create(url=url, url_hash=digest)
    except IntegrityError:
        # Two posts mentioning the same new URL in the same instant. The
        # unique index decided; read back the winner.
        return LinkPreview.objects.filter(url_hash=digest).first()

    from links.tasks import fetch_preview

    preview_id = row.pk
    transaction.on_commit(lambda: fetch_preview.delay(preview_id))
    return row
