"""Object storage — presigned URLs and the small amount of S3 this app needs.

MinIO locally, Cloudflare R2 in production, same API either way. Bytes never
pass through this server at any scale: the browser PUTs straight to storage
against a presigned URL, and the worker reads back from it.

Not in `core/` because it talks to the network and reads settings. Not in
`services.py` because it is infrastructure rather than a business
transaction — a service calls this, not the other way round.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import boto3
from botocore.config import Config as BotoConfig
from django.conf import settings

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client


def client() -> S3Client:
    """An S3 client pointed at whatever is configured.

    `s3v4` explicitly: MinIO accepts it, R2 requires it, and the default
    varies by botocore version — which is the kind of thing that works in
    development and 403s in production.
    """
    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_S3_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_S3_REGION_NAME,
        config=BotoConfig(signature_version="s3v4"),
    )


def presigned_put(
    *, bucket: str, key: str, content_type: str, content_length: int
) -> str:
    """A URL the browser may PUT exactly one specific file to.

    Both constraints matter and are signed into the URL:

    - **content-type** — so the URL cannot be used to place an executable
      where an image is expected.
    - **content-length** — exact, not a range. The client already told us the
      size at intent time, so anything else is a different file.

    Five-minute expiry, per `01-ARCHITECTURE.md` §6. An unconstrained,
    long-lived presigned URL is a free file host for anyone who finds it.
    """
    return client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": content_length,
        },
        ExpiresIn=settings.S3_PRESIGNED_PUT_EXPIRY_SECONDS,
        HttpMethod="PUT",
    )


def download(*, bucket: str, key: str) -> bytes:
    """Read an object back. Used by the worker, never by a request path."""
    response = client().get_object(Bucket=bucket, Key=key)
    body: bytes = response["Body"].read()
    return body


def upload(*, bucket: str, key: str, data: bytes, content_type: str) -> None:
    """Write a derivative. Worker only."""
    client().put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )


def head(*, bucket: str, key: str) -> int | None:
    """Size of an object, or None if it is not there.

    The worker uses this to tell "the browser never finished the PUT" apart
    from "the file is bad", which are different failures with different
    messages.
    """
    try:
        response = client().head_object(Bucket=bucket, Key=key)
    except client().exceptions.ClientError:
        return None
    length: int = response["ContentLength"]
    return length


def public_url(*, bucket: str, key: str) -> str:
    """A readable URL for an object in the public media bucket.

    MinIO's `media` bucket is anonymous-download in development, and R2 sits
    behind a CDN domain in production, so this is a formatting concern rather
    than a signing one. DM media lives in a separate, private bucket and does
    not come through here.
    """
    base = settings.AWS_S3_PUBLIC_BASE_URL.rstrip("/")
    return f"{base}/{bucket}/{key}"
