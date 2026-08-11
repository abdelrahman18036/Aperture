"""Moderation owns no tables yet.

Phase 5 adds the report queue, the moderation console built on django-unfold,
and the Redis token bucket for rate limits. `01-ARCHITECTURE.md` §5 specifies
no moderation tables, so none are modelled here in Phase 1 — inventing a
schema ahead of the phase that designs it would be guessing.

What Phase 5 will add: a `reports` table, and `has_*_permission` gating on
every admin action.
"""

from __future__ import annotations
