"""Calls own no tables.

Phase 7 mints LiveKit tokens with `livekit-api` and nothing more. Signalling
is an ephemeral event class on the existing realtime socket — offers and
answers are never persisted, and a call that ends leaves nothing behind that
needs a row.

If a call-history feature ever lands, it belongs here. Until then this module
stays empty on purpose, so the app keeps the same eight files as every other.
"""

from __future__ import annotations
