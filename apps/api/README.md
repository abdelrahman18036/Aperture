# Aperture API

The Django 6.1 API owns persistence, authentication, moderation, background
jobs, and realtime tickets. The root [README](../../README.md) is the source of
truth for full-stack setup and architecture.

From this directory, with the backing services running:

```bash
uv run manage.py migrate
uv run uvicorn config.asgi:application --reload --port 8000
uv run celery -A config worker --loglevel=info --pool=solo
uv run celery -A config beat --loglevel=info
```

Quality gates:

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest -q
```

`uv run manage.py seed_demo` creates or refreshes the deterministic local demo
corpus and resets seeded accounts to the password printed by the command.
