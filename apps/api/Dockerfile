# Django — API and worker. One image, two commands.
#
# The API and the Celery worker share models, settings and code and differ
# only in what they run, so they share an image and are separated by the
# command rather than by a second Dockerfile that would drift.
#
#   docker build -f apps/api/Dockerfile -t aperture-api .   # from the repo root
#
# The build context is the repo root because that is where the compose file
# and `infra/` expect to be run from, and a context that differs per image is
# a trap even when a narrower one would work.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
#
# A separate stage because `blurhash-python` ships no wheel and compiles from
# source — it needs a C toolchain, which the runtime image has no business
# carrying. `gcc` in a production image is both weight and attack surface for
# something used once at build time.

FROM python:3.13-slim AS build

# uv, copied from its own image rather than installed with pip: pip is not on
# PATH in this project by policy, and the tag pins the same uv this repository
# is developed against.
COPY --from=ghcr.io/astral-sh/uv:0.10.11 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install --no-install-recommends -y gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# `UV_PYTHON_DOWNLOADS=never` is the line that makes this image work. Left to
# itself uv fetches its own CPython into `/root/.local/share/uv/python` and
# points the venv's `bin/python` symlink at it — which resolves in the build
# stage and dangles in the runtime one, where the only symptom is "Couldn't
# import Django" from an interpreter that appears to be present. The base
# image ships 3.13.15, which already satisfies `requires-python`.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON=/usr/local/bin/python3.13 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies first, and from the lockfile only. `--frozen` fails rather than
# resolving, so an image can never quietly ship a different dependency tree
# from the one that was tested. This layer is cached until the lock changes.
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/api/ ./

# Installed after the source is present, so the project itself is in the
# environment rather than only its dependencies.
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

FROM python:3.13-slim AS runtime

# `ffmpeg` and `ffprobe` are a hard runtime dependency of `media.tasks`, not a
# convenience: video posts fail to process without them, and the failure is a
# `FileNotFoundError` deep inside a Celery task rather than anything obvious.
# `libpq5` is for psycopg's binary wheel.
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libpq5 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app /app

# WhiteNoise serves from `STATIC_ROOT`, and uvicorn serves no static files of
# its own — this is not optional, and skipping it is how the admin ends up
# rendering as unstyled HTML. Run with the development settings so it cannot
# fail on a secret that only exists at deploy time.
RUN DJANGO_DEBUG=1 python manage.py collectstatic --noinput

# Not root. The container writes nothing outside `/tmp`.
RUN useradd --system --create-home --uid 10001 aperture \
    && chown -R aperture:aperture /app
USER aperture

EXPOSE 8000

# The API. The worker and the scheduler override this:
#
#   celery -A config worker --loglevel=info
#   celery -A config beat
#
# `--proxy-headers` because `SECURE_PROXY_SSL_HEADER` is only honoured if
# uvicorn passes the header through in the first place.
CMD ["uvicorn", "config.asgi:application", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
