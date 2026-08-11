"""Django settings for Aperture's API and worker processes.

Both `uvicorn config.asgi:application` and `celery -A config worker` load this
module. They share models and settings and deploy independently; the realtime
gateway shares neither and lives in `apps/realtime`.

Everything environment-specific is read from the environment with a
development-only default, so a clean clone runs after `docker compose up` with
no `.env.local` at all. `.env.example` documents every variable.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

DEBUG = env_bool("DJANGO_DEBUG", True)

SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    # Development only. Production must set this; there is no fallback worth
    # having, and `manage.py check --deploy` will say so.
    "dev-only-insecure-key-do-not-use-outside-local-development",
)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "[::1]"])

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

# Every Aperture model supplies its own snowflake primary key. This only
# covers Django's own tables (sessions, admin log, permissions).
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "users.User"

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

INSTALLED_APPS = [
    # Unfold must precede django.contrib.admin — it overrides admin templates,
    # so load order is not optional. See docs/vendor/django-unfold.md.
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "unfold.contrib.inlines",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # Third party
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    # Aperture
    "users",
    "media",
    "posts",
    "counters",
    "messaging",
    "calls",
    "moderation",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
#
# Host port 5433, not 5432: a native postgresql-x64-17 Windows service holds
# 5432 on this machine. Inside the compose network it is still postgres:5432.
# See docs/VERSIONS.md.

DATABASES = {
    "default": dj_database_url.config(
        default="postgres://app:devpassword@localhost:5433/aperture",
        conn_max_age=600,
        conn_health_checks=True,
    ),
}

# ---------------------------------------------------------------------------
# Redis — cache, Celery broker, and the pub/sub bus to apps/realtime
# ---------------------------------------------------------------------------

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    },
}

CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", REDIS_URL)
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 600
CELERY_TASK_SOFT_TIME_LIMIT = 540

# ---------------------------------------------------------------------------
# Sessions, CSRF and auth
# ---------------------------------------------------------------------------
#
# Next.js rewrites /api/* to Django, so the browser sees one origin and this
# cookie is same-site. No JWT in localStorage, no CORS credential dance.
# See 01-ARCHITECTURE.md §3.

SESSION_ENGINE = "django.contrib.sessions.backends.cached_db"
SESSION_COOKIE_NAME = "aperture_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG

CSRF_COOKIE_NAME = "aperture_csrftoken"
CSRF_COOKIE_HTTPONLY = False  # the browser must read it to echo the header
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]
)

# Should be barely needed — the rewrite makes the browser same-origin. Kept
# for direct API access during development only.
CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]
)
CORS_ALLOW_CREDENTIALS = True

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
        )
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Object storage — MinIO locally, Cloudflare R2 in production
# ---------------------------------------------------------------------------
#
# Same S3 API either way, so this is an env var change and nothing more.
# Bytes never pass through this server: the browser PUTs to a presigned URL.

AWS_S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL", "http://localhost:9000")
AWS_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", "minioadmin")
AWS_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "minioadmin")
AWS_S3_REGION_NAME = os.environ.get("S3_REGION", "us-east-1")
AWS_STORAGE_BUCKET_NAME = os.environ.get("S3_MEDIA_BUCKET", "media")

S3_DM_MEDIA_BUCKET = os.environ.get("S3_DM_MEDIA_BUCKET", "dm-media")

#: Presigned PUT lifetime. Short on purpose — an unconstrained, long-lived
#: presigned URL is a free file host for anyone who finds it.
S3_PRESIGNED_PUT_EXPIRY_SECONDS = 300

STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": AWS_STORAGE_BUCKET_NAME,
            "endpoint_url": AWS_S3_ENDPOINT_URL,
            "region_name": AWS_S3_REGION_NAME,
        },
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# ---------------------------------------------------------------------------
# Realtime
# ---------------------------------------------------------------------------
#
# The one secret Django and apps/realtime share. Django signs a 60-second
# HS256 ticket with it; the gateway verifies and never calls back. It lives in
# the environment, never in code — see 01-ARCHITECTURE.md §8.

REALTIME_TICKET_SECRET = os.environ.get(
    "REALTIME_TICKET_SECRET", "dev-only-insecure-ticket-secret"
)
REALTIME_TICKET_TTL_SECONDS = 60
REALTIME_URL = os.environ.get("REALTIME_URL", "ws://localhost:4000/ws")

# ---------------------------------------------------------------------------
# DRF and the OpenAPI schema — the type boundary
# ---------------------------------------------------------------------------

REST_FRAMEWORK: dict[str, Any] = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
}

SPECTACULAR_SETTINGS: dict[str, Any] = {
    "TITLE": "Aperture API",
    "DESCRIPTION": (
        "Aperture's HTTP API. This schema is the single source of truth for "
        "the frontend's types: it generates packages/api-client, which is "
        "never hand-edited."
    ),
    "VERSION": "0.1.0",
    # 01-ARCHITECTURE.md §1 specifies OpenAPI 3.1. drf-spectacular still
    # defaults to 3.0.3, so ask for it explicitly.
    "OAS_VERSION": "3.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api",
}

# ---------------------------------------------------------------------------
# Admin — a tool, not a design surface
# ---------------------------------------------------------------------------
#
# Title, theme, radius, and a primary ramp lifted from 02-DESIGN-SYSTEM.md's
# safelight. Then stop: no custom dashboard, no STYLES overrides, no bespoke
# templates.

UNFOLD: dict[str, Any] = {
    "SITE_TITLE": "Aperture",
    "SITE_HEADER": "Aperture",
    "SITE_SUBHEADER": "Moderation console",
    "THEME": "dark",
    "BORDER_RADIUS": "6px",
    "SHOW_UI_WARNINGS": DEBUG,
    "COLORS": {
        # The safelight ramp. 500 is --color-safelight and 800 is
        # --color-safelight-dim, both verbatim from the design system.
        "primary": {
            "50": "oklch(0.971 0.020 55)",
            "100": "oklch(0.940 0.040 55)",
            "200": "oklch(0.898 0.070 55)",
            "300": "oklch(0.856 0.100 55)",
            "400": "oklch(0.812 0.130 55)",
            "500": "oklch(0.760 0.155 55)",
            "600": "oklch(0.680 0.145 55)",
            "700": "oklch(0.590 0.120 55)",
            "800": "oklch(0.470 0.090 55)",
            "900": "oklch(0.380 0.070 55)",
            "950": "oklch(0.300 0.050 55)",
        },
    },
}

# ---------------------------------------------------------------------------
# Mail
# ---------------------------------------------------------------------------
#
# Django 6.1 deprecates the EMAIL_* settings in favour of MAILERS, so write
# the new form from the start. See docs/vendor/django-6.1.md.

MAILERS = {
    "default": {
        "BACKEND": os.environ.get(
            "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"
        ),
    },
}

# ---------------------------------------------------------------------------
# Internationalisation and static files
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO"),
    },
}
