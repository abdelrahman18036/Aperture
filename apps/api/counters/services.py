"""Writes for the counters app.

Business transactions live here, and this is the only place `.save()` is
called. Increments arrive from Celery tasks, never from a request path.
"""
