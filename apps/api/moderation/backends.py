"""The two safety providers, as contracts rather than integrations.

`01-ARCHITECTURE.md` §11 requires CSAM scanning and an NCMEC path from day
one. Neither can be implemented here: hash matching means PhotoDNA or
Cloudflare's CSAM Scanning Tool, and filing means a registered ESP account
with NCMEC's CyberTipline. Both are accounts somebody signs for, not code.

What *can* be here — and what was missing — is a seam narrow enough that the
rest of the pipeline can be proven without either. Before this, `_match` and
`_deliver` raised `NotImplementedError` inline, which meant the enabled path
had never run: nothing had ever exercised "a match suspends the owner and
files a report", because there was no way to make a match happen. The code
either side of the provider was untested by construction.

So each provider is a dotted path in settings, defaulting to the refusals
below. A deployment points them at a real client; the tests point them at a
fake and assert what happens around them. Neither has to lie about the other.

The contracts:

    match(media) -> bool
        True if this image matches known CSAM. Raising is a *failure*, not a
        negative — the caller must never read an error as "clean".

    deliver(report) -> None
        Files the report. Returning means it is filed and the report may be
        stamped `escalated_at`. Raising means it is not, and the task retries.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover — imports for typing only
    from media.models import Media
    from moderation.models import Report


class ProviderNotConfiguredError(NotImplementedError):
    """No real provider is wired, and the setting says there should be.

    A subclass of `NotImplementedError` so existing handling still catches
    it, and its own type so a test can assert *this* rather than any
    accidental one.
    """


def unconfigured_match(media: Media) -> bool:
    """The default. Refuses rather than returning False.

    Returning False would be a scanner that passes everything and reports
    itself as working, which is the worst possible failure for this
    particular feature.
    """
    raise ProviderNotConfiguredError(
        "No CSAM hash-matching provider is wired. Point CSAM_HASH_BACKEND at "
        "one before setting CSAM_SCANNING_ENABLED."
    )


def unconfigured_deliver(report: Report) -> None:
    """The default. Refuses, so nothing is ever marked filed that was not."""
    raise ProviderNotConfiguredError(
        "NCMEC CyberTipline delivery is not wired. Point NCMEC_BACKEND at an "
        "implementation before setting NCMEC_REPORTING_ENABLED."
    )
