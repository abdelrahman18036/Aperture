"""A hash-list CSAM backend, for operators who hold a list.

**Read this before switching it on.**

This is not PhotoDNA and does not pretend to be. PhotoDNA and Cloudflare's
CSAM Scanning Tool are perceptual matchers, robust to resizing, recompression
and cropping, run by organisations with the legal standing to hold the corpus.
Nothing here can substitute for that, and `moderation/backends.py` still
defaults to refusing rather than to this.

What this *is*: exact-hash matching against a list the operator supplies —
which is the form NCMEC, IWF and the Tech Coalition distribute to registered
entities, and which a self-hosting operator entitled to such a list has no
other way to use here. It catches redistribution of known files unchanged. It
misses anything re-encoded, and that limitation is the reason it is one
backend among others rather than the answer.

    CSAM_SCANNING_ENABLED=1
    CSAM_HASH_BACKEND=moderation.hashlist.match
    CSAM_HASH_LIST=/etc/aperture/known-hashes.txt

The list is one lowercase hex SHA-256 per line; `#` starts a comment. It is
read once and cached, because a worker that re-reads a million-line file per
upload is a worker that stops keeping up.

**A missing or unreadable list raises.** It does not quietly match nothing —
a scanner that answers "clean" because its corpus failed to load is worse
than no scanner, since it reports itself as working. That is the same rule
`unconfigured_match` follows and the reason both refuse rather than return
False.
"""

from __future__ import annotations

import hashlib
import logging
from functools import lru_cache
from pathlib import Path

from django.conf import settings

from media import storage
from media.models import Media
from moderation.backends import ProviderNotConfiguredError

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def known_hashes(path: str) -> frozenset[str]:
    """The list, read once.

    Keyed on the path so a test can point at a different file and get a
    different set rather than a cached one from another test.
    """
    source = Path(path)
    if not source.is_file():
        raise ProviderNotConfiguredError(
            f"CSAM_HASH_LIST points at {path!r}, which is not a readable file."
        )

    entries = set()
    for raw in source.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip().lower()
        if line:
            entries.add(line)

    if not entries:
        raise ProviderNotConfiguredError(f"The hash list at {path!r} is empty.")

    logger.info("loaded %s known hashes from %s", len(entries), path)
    return frozenset(entries)


def sha256_of(media: Media) -> str:
    """The uploaded bytes, hashed.

    The original rather than a derivative: derivatives are re-encoded by our
    own worker, so their hashes match nothing anybody else has ever seen.
    """
    blob = storage.download(bucket=media.bucket, key=media.object_key)
    return hashlib.sha256(blob).hexdigest()


def match(media: Media) -> bool:
    """True if this upload is a byte-for-byte known file."""
    path = getattr(settings, "CSAM_HASH_LIST", "")
    if not path:
        raise ProviderNotConfiguredError(
            "CSAM_HASH_BACKEND is the hash list, but CSAM_HASH_LIST is unset."
        )

    return sha256_of(media) in known_hashes(path)
