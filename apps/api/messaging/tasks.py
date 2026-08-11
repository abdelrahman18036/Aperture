"""Celery tasks for the messaging app.

Empty on purpose, and present on purpose — rule 2 keeps every app's file list
identical so there is never a question of where something goes.

Messaging has no background work: `seq` allocation and `client_id` idempotency
must happen inside the request's transaction, and the socket event is published
from `transaction.on_commit` rather than from a worker. Handing either to a
queue would mean a message could be accepted and then ordered later, which is
the one thing `01-ARCHITECTURE.md` §5 rules out.
"""
