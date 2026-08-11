"""ASGI entry point — `uvicorn config.asgi:application`.

ASGI rather than WSGI because the API process is async-capable, not because
it holds sockets. It does not: WebSockets belong to `apps/realtime`, which is
a separate Node service. See `01-ARCHITECTURE.md` §8.
"""

from __future__ import annotations

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()
