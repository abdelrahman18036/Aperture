"""Celery tasks for the media app.

The worker: validate the real file, derive what the UI needs, flip the state.
It runs in the `celery -A config worker` process, which shares models and
settings with the API but scales on queue depth rather than request rate.

Nothing here trusts anything the client said. `declared_mime` is only ever
used as the thing to *compare against*.
"""

from __future__ import annotations

import io
import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import blurhash
from celery import shared_task
from PIL import Image, UnidentifiedImageError

from core.media import (
    DERIVATIVE_FORMAT,
    DERIVATIVE_WIDTHS,
    Kind,
    UploadRejectedError,
    derivative_key,
    detect_mime,
    poster_key,
    reconcile_detected_mime,
    transcode_key,
    validate_image_dimensions,
    validate_video_duration,
)
from media import selectors, services, storage
from media.models import Media

logger = logging.getLogger(__name__)

#: Enough for any container header the sniffer cares about.
SNIFF_BYTES = 8192

#: Blurhash component counts. 4x3 is what Wolt's reference implementation
#: suggests for landscape-ish content and is plenty at the size it renders.
BLURHASH_COMPONENTS_X = 4
BLURHASH_COMPONENTS_Y = 3

#: `ffmpeg` and `ffprobe` are expected on PATH. Verified 7.1.1 on this
#: machine; the Docker image installs them.
FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

FFMPEG_TIMEOUT_SECONDS = 300


@dataclass(frozen=True, slots=True)
class Derived:
    """Everything the worker learned, ready for `mark_ready`."""

    width: int | None
    height: int | None
    duration_ms: int | None
    blurhash: str
    dominant_color: str


@shared_task(
    name="media.process",
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def process_media(self: Any, media_id: int) -> str:
    """Validate and derive one media row.

    Terminal either way: the row leaves `pending` for `ready` or `failed`. A
    retry only happens for errors that look transient (storage hiccups), never
    for a file that is simply wrong — retrying a rejected upload three times
    just delays telling the user.
    """
    media = Media.objects.filter(pk=media_id).first()
    if media is None:
        logger.warning("media %s vanished before processing", media_id)
        return "missing"

    if media.state != Media.State.PENDING:
        # Idempotent: `complete` may be called twice, and acks_late means a
        # task can be redelivered after a worker dies mid-flight.
        return media.state

    try:
        derived = _derive(media)
    except UploadRejectedError as exc:
        services.mark_failed(media=media, reason=str(exc))
        return Media.State.FAILED
    except Exception as exc:  # decide retry vs fail below
        logger.exception("media %s failed to process", media_id)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc) from exc
        services.mark_failed(media=media, reason="Processing failed. Please try again.")
        return Media.State.FAILED

    services.mark_ready(
        media=media,
        width=derived.width,
        height=derived.height,
        duration_ms=derived.duration_ms,
        blurhash=derived.blurhash,
        dominant_color=derived.dominant_color,
    )
    return Media.State.READY


def _derive(media: Media) -> Derived:
    """Fetch, check, and produce. Raises `UploadRejectedError` with a user message."""
    size = storage.head(bucket=media.bucket, key=media.object_key)
    if size is None:
        raise UploadRejectedError("The upload never finished. Please try again.")
    if size != media.declared_size_bytes:
        # The presigned URL signs an exact content-length, so this should be
        # unreachable. It is checked anyway: the day it becomes reachable is
        # the day the signing changed.
        raise UploadRejectedError("The uploaded file does not match what was declared.")

    data = storage.download(bucket=media.bucket, key=media.object_key)

    detected = detect_mime(data[:SNIFF_BYTES])
    kind: Kind = "image" if media.kind == Media.Kind.IMAGE else "video"
    reconcile_detected_mime(declared=media.declared_mime, detected=detected, kind=kind)

    if media.kind == Media.Kind.IMAGE:
        return _derive_image(media, data)
    return _derive_video(media, data)


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


def _derive_image(media: Media, data: bytes) -> Derived:
    """Pillow's `verify()` is the real gate; the sniffer was the cheap one."""
    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise UploadRejectedError("That image is corrupt or unreadable.") from exc

    # `verify()` leaves the image unusable, so reopen to actually work with it.
    try:
        opened = Image.open(io.BytesIO(data))
        image = opened.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise UploadRejectedError("That image could not be decoded.") from exc

    width, height = image.size
    validate_image_dimensions(width, height)

    for target in DERIVATIVE_WIDTHS:
        storage.upload(
            bucket=media.bucket,
            key=derivative_key(media.pk, target),
            data=resize_to_webp(image, target),
            content_type=f"image/{DERIVATIVE_FORMAT}",
        )

    return Derived(
        width=width,
        height=height,
        duration_ms=None,
        blurhash=blurhash_of(image),
        dominant_color=dominant_color_of(image),
    )


def resize_to_webp(image: Image.Image, target_width: int) -> bytes:
    """One derivative. Never upscales — a 400px original stays 400px."""
    width, height = image.size
    if target_width >= width:
        resized = image
    else:
        target_height = max(1, round(height * (target_width / width)))
        resized = image.resize((target_width, target_height), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    resized.save(buffer, format=DERIVATIVE_FORMAT.upper(), quality=82, method=4)
    return buffer.getvalue()


def blurhash_of(image: Image.Image) -> str:
    """Encoded from a small copy — blurhash is O(pixels) and we need none."""
    small = image.copy()
    small.thumbnail((64, 64), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    small.save(buffer, format="JPEG", quality=80)
    buffer.seek(0)
    encoded: str = blurhash.encode(buffer, BLURHASH_COMPONENTS_X, BLURHASH_COMPONENTS_Y)
    return encoded


def dominant_color_of(image: Image.Image) -> str:
    """Feeds the ambient glow. One pixel is genuinely enough at 8% opacity."""
    pixel = image.resize((1, 1), Image.Resampling.LANCZOS).getpixel((0, 0))
    if not isinstance(pixel, tuple):
        return "#000000"
    red, green, blue = pixel[:3]
    return f"#{red:02x}{green:02x}{blue:02x}"


# ---------------------------------------------------------------------------
# Video
#
# Deliberately not a transcoding pipeline. One ffmpeg subprocess producing
# 720p H.264 is fine locally; production hands video to Mux. Adaptive bitrate
# ladders and per-device codec selection are a multi-quarter project and not
# our product — `01-ARCHITECTURE.md` §6.
# ---------------------------------------------------------------------------


def _derive_video(media: Media, data: bytes) -> Derived:
    with tempfile.TemporaryDirectory(prefix="aperture-") as workdir:
        source = Path(workdir) / "source"
        source.write_bytes(data)

        stream = _ffprobe_video_stream(source)
        width = int(stream.get("width") or 0)
        height = int(stream.get("height") or 0)
        duration_ms = _duration_ms_of(stream)

        validate_image_dimensions(width, height)
        validate_video_duration(duration_ms)

        poster = Path(workdir) / "poster.webp"
        _run(
            [
                FFMPEG,
                "-y",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-vf",
                "scale=1080:-2",
                str(poster),
            ]
        )
        storage.upload(
            bucket=media.bucket,
            key=poster_key(media.pk),
            data=poster.read_bytes(),
            content_type=f"image/{DERIVATIVE_FORMAT}",
        )

        transcoded = Path(workdir) / "720p.mp4"
        _run(
            [
                FFMPEG,
                "-y",
                "-i",
                str(source),
                "-vf",
                "scale=-2:min(720\\,ih)",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                # Move the index to the front so the browser can start
                # playing before the whole file has arrived.
                "-movflags",
                "+faststart",
                str(transcoded),
            ]
        )
        storage.upload(
            bucket=media.bucket,
            key=transcode_key(media.pk),
            data=transcoded.read_bytes(),
            content_type="video/mp4",
        )

        with Image.open(poster) as frame:
            rgb = frame.convert("RGB")
            return Derived(
                width=width,
                height=height,
                duration_ms=duration_ms,
                blurhash=blurhash_of(rgb),
                dominant_color=dominant_color_of(rgb),
            )


def _ffprobe_video_stream(path: Path) -> dict[str, Any]:
    """The first video stream, or a rejection.

    A container with no video stream is an audio file with a video extension,
    which is exactly the kind of thing the declared/detected check cannot see.
    """
    result = _run(
        [
            FFPROBE,
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration,codec_name",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ]
    )
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError as exc:
        raise UploadRejectedError("That video could not be read.") from exc

    streams = parsed.get("streams") or []
    if not streams:
        raise UploadRejectedError("That file contains no video.")

    stream: dict[str, Any] = streams[0]
    stream["_format_duration"] = (parsed.get("format") or {}).get("duration")
    return stream


def _duration_ms_of(stream: dict[str, Any]) -> int:
    """Stream duration, falling back to the container's.

    Some encoders leave the stream duration unset; the container almost always
    has it.
    """
    for candidate in (stream.get("duration"), stream.get("_format_duration")):
        if candidate in (None, "", "N/A"):
            continue
        try:
            return int(float(candidate) * 1000)
        except (TypeError, ValueError):
            continue
    raise UploadRejectedError("That video has no readable duration.")


def _run(command: list[str]) -> str:
    """Run ffmpeg/ffprobe, converting failure into a user-facing rejection."""
    try:
        completed = subprocess.run(  # noqa: S603 — fixed argv, no shell
            command,
            capture_output=True,
            text=True,
            timeout=FFMPEG_TIMEOUT_SECONDS,
            check=True,
        )
    except FileNotFoundError as exc:
        # An operator problem, not a user one. Let it retry and page someone.
        raise RuntimeError(f"{command[0]} is not on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise UploadRejectedError("That video took too long to process.") from exc
    except subprocess.CalledProcessError as exc:
        logger.warning("%s failed: %s", command[0], exc.stderr[:500])
        raise UploadRejectedError("That video could not be processed.") from exc
    return completed.stdout


@shared_task(name="media.reap_abandoned_intents")
def reap_abandoned_intents(older_than_seconds: int = 3600) -> int:
    """Soft-delete rows whose bytes never arrived.

    A presigned URL lives five minutes; a row still `pending` an hour later is
    an upload the browser gave up on. Phase 5 schedules this — it is here now
    because the query it needs is already written.
    """
    stale = selectors.stale_pending(older_than_seconds=older_than_seconds)
    reaped = 0
    for media in stale.iterator():
        services.mark_failed(media=media, reason="Upload was never completed.")
        reaped += 1
    return reaped
