"""Reads for the posts app.

Every query in this app lives here and returns a queryset. Views never touch
the ORM directly -- that is what makes the block-filtering audit in
`01-ARCHITECTURE.md` §11 a one-file job instead of a forty-view job.

No `.count()` and no `COUNT(*)` on anything a request can reach: use the
`counters` table, cached in Redis.
"""
