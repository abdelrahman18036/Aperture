"""Cached Open Graph previews for links people post.

**Keyed on the URL, not on the post.** Ten people sharing the same article is
one row and one fetch; a preview per post would be ten requests to somebody
else's server for the same page, which is rude at small scale and a
thundering herd at large.

Nothing here is authored by us. Every field is somebody else's HTML, so
everything is optional, everything is length-capped, and the client escapes
all of it — a `title` is a string we found in a `<meta>` tag, not a fact.
"""

from __future__ import annotations

import hashlib

from django.db import models

from core.ids import snowflake


class LinkPreview(models.Model):
    """What one URL looked like the last time we asked."""

    class State(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        #: Refused by the guard, unreachable, or carrying nothing worth
        #: showing. Kept as a row so the same URL is not retried on every
        #: post that mentions it.
        FAILED = "failed", "Failed"

    id = models.BigIntegerField(primary_key=True, default=snowflake, editable=False)

    #: The URL as posted, and a hash of it for the unique index. A URL can be
    #: longer than the 255 bytes an index wants, so the constraint is on the
    #: digest and the text is along for the ride.
    url = models.TextField()
    url_hash = models.CharField(max_length=64, unique=True, editable=False)

    state = models.CharField(
        max_length=10, choices=State.choices, default=State.PENDING
    )

    title = models.CharField(max_length=300, blank=True)
    description = models.CharField(max_length=600, blank=True)
    image_url = models.TextField(blank=True)
    site_name = models.CharField(max_length=120, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    fetched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "link_previews"

    def __str__(self) -> str:
        return f"{self.state}: {self.url[:60]}"

    def save(self, *args: object, **kwargs: object) -> None:
        if not self.url_hash:
            self.url_hash = self.hash_for(self.url)
        super().save(*args, **kwargs)  # type: ignore[arg-type]

    @staticmethod
    def hash_for(url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()
