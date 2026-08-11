"""Celery application for the worker process.

`celery -A config worker` loads this. The worker shares models and settings
with the API process but deploys independently and scales on queue depth
rather than request rate.
"""

from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("aperture")

# Every CELERY_-prefixed Django setting becomes Celery configuration.
app.config_from_object("django.conf:settings", namespace="CELERY")

# Picks up tasks.py in each installed app.
app.autodiscover_tasks()
