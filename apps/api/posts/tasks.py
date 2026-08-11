"""Celery tasks for the posts app.

Counter movements live in `counters.tasks` — one task, called from every
service, rather than a task per event. What belongs here is work specific to
posts, of which there is none yet: Phase 8's fanout is the first.
"""

from __future__ import annotations
