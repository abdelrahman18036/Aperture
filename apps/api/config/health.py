"""Health check — does this process actually have its dependencies?

Deliberately lives at project level rather than in an app: it is operational
plumbing, not a domain concern, and it belongs to no aggregate. The eight-file
layout in `01-ARCHITECTURE.md` §2 governs apps, and this is not one.

It checks the three things a broken clone is most likely to be missing, and it
checks them by doing real work rather than by reading configuration: a query,
a `PING`, and a bucket lookup.
"""

from __future__ import annotations

import time
from typing import Any, Literal

import boto3
import redis
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.db import connections
from django.db.utils import OperationalError
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

CheckStatus = Literal["ok", "failing"]


class HealthCheckSerializer(serializers.Serializer[dict[str, Any]]):
    """One dependency's result."""

    name = serializers.CharField()
    status = serializers.ChoiceField(choices=["ok", "failing"])
    latency_ms = serializers.FloatField()
    detail = serializers.CharField(allow_blank=True)


class HealthSerializer(serializers.Serializer[dict[str, Any]]):
    """The whole report."""

    status = serializers.ChoiceField(choices=["ok", "degraded"])
    checks = HealthCheckSerializer(many=True)


def _timed(name: str, probe: Any) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        probe()
    except Exception as exc:  # a health check reports failure, never raises
        return {
            "name": name,
            "status": "failing",
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "detail": f"{type(exc).__name__}: {exc}",
        }
    return {
        "name": name,
        "status": "ok",
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        "detail": "",
    }


def _check_postgres() -> None:
    connection = connections["default"]
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        if cursor.fetchone() != (1,):
            raise OperationalError("unexpected result from SELECT 1")


def _check_redis() -> None:
    client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
    try:
        if not client.ping():
            raise ConnectionError("PING returned falsey")
    finally:
        client.close()


def _check_object_storage() -> None:
    client = boto3.client(
        "s3",
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_S3_REGION_NAME,
        config=BotoConfig(
            connect_timeout=2, read_timeout=2, retries={"max_attempts": 1}
        ),
    )
    try:
        client.head_bucket(Bucket=settings.AWS_STORAGE_BUCKET_NAME)
    except (ClientError, BotoCoreError) as exc:
        raise ConnectionError(
            f"bucket {settings.AWS_STORAGE_BUCKET_NAME!r} unreachable: {exc}"
        ) from exc


class HealthView(APIView):
    """`GET /api/health` — 200 when every dependency answers, 503 otherwise.

    Unauthenticated on purpose: a load balancer has no session cookie, and the
    response leaks nothing beyond which of our own services are up.
    """

    permission_classes = [AllowAny]
    authentication_classes: list[type] = []

    @extend_schema(
        operation_id="health",
        responses={200: HealthSerializer, 503: HealthSerializer},
        auth=[],
        description=(
            "Liveness and dependency check. Verifies Postgres, Redis and "
            "object storage by performing real operations against each."
        ),
    )
    def get(self, request: Request) -> Response:
        checks = [
            _timed("postgres", _check_postgres),
            _timed("redis", _check_redis),
            _timed("object_storage", _check_object_storage),
        ]
        healthy = all(check["status"] == "ok" for check in checks)
        payload = {
            "status": "ok" if healthy else "degraded",
            "checks": checks,
        }
        return Response(
            HealthSerializer(payload).data,
            status=(
                status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
            ),
        )
