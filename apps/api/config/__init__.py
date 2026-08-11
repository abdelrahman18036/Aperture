"""Aperture's Django project.

Importing the Celery app here means `@shared_task` resolves to it no matter
which process starts first.
"""

from config.celery import app as celery_app

__all__ = ("celery_app",)
