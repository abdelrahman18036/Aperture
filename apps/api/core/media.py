"""Upload rules — what we accept, and how we decide a file is what it claims.

Pure functions over plain data. No Django, no boto3, no filesystem: the
policy lives here so it can be tested exhaustively in milliseconds, and the
`media` app is left holding only the plumbing.

The rule this module exists for, from `01-ARCHITECTURE.md` §6:

    Validate the *file*, not the client's claim. A declared `image/jpeg` that
    is really something else is the first upload attack you will see.

So nothing here trusts `declared_mime` for anything except deciding what to
compare against.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

import puremagic

__all__ = [
    "MAX_IMAGE_BYTES",
    "MAX_VIDEO_BYTES",
    "MAX_VIDEO_DURATION_MS",
    "Kind",
    "UploadRejectedError",
    "derivative_key",
    "detect_mime",
    "normalise_mime",
    "object_key",
    "poster_key",
    "reconcile_detected_mime",
    "transcode_key",
    "validate_intent",
]

Kind = Literal["image", "video"]


class UploadRejectedError(Exception):
    """An upload is not acceptable. The message is safe to show a user."""


# ---------------------------------------------------------------------------
# What we accept
# ---------------------------------------------------------------------------

#: Deny by default. A type absent from this map cannot be uploaded, whatever
#: the client claims and whatever the sniffer detects.
ALLOWED: Final[dict[Kind, frozenset[str]]] = {
    "image": frozenset({"image/jpeg", "image/png", "image/webp", "image/avif"}),
    "video": frozenset({"video/mp4", "video/quicktime", "video/webm"}),
}

#: Aliases browsers and phones send. Normalised before anything else looks at
#: them, so the rest of the module only ever sees canonical types.
MIME_ALIASES: Final[dict[str, str]] = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/x-png": "image/png",
    "video/x-m4v": "video/mp4",
    "video/mov": "video/quicktime",
    "video/x-quicktime": "video/quicktime",
}

MAX_IMAGE_BYTES: Final = 25 * 1024 * 1024
MAX_VIDEO_BYTES: Final = 300 * 1024 * 1024
MAX_VIDEO_DURATION_MS: Final = 90_000

#: Refuse a zero-byte or absurdly small "image" before spending a presigned
#: URL on it.
MIN_BYTES: Final = 64

MAX_DIMENSION: Final = 12_000
"""Guards against a decompression bomb: a small file claiming vast pixels."""

MAX_PIXELS: Final = 80_000_000
"""Roughly 80MP. Pillow's own bomb check is separate and also left enabled."""


#: Canonical file extension per accepted type, so object keys are predictable
#: and a bucket listing is readable by a human.
EXTENSIONS: Final[dict[str, str]] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
}


@dataclass(frozen=True, slots=True)
class UploadIntent:
    """A validated request to upload. Produced only by `validate_intent`.

    Carries no object key: that needs the media id, which does not exist
    until the row does. See `object_key()`.
    """

    kind: Kind
    mime: str
    size_bytes: int


def normalise_mime(mime: str) -> str:
    """Lowercase, strip parameters, and resolve known aliases.

    Browsers send `image/jpeg; charset=binary` and phones send `image/jpg`.
    Neither is worth a rejection.
    """
    base = mime.split(";", 1)[0].strip().lower()
    return MIME_ALIASES.get(base, base)


def max_bytes_for(kind: Kind) -> int:
    return MAX_IMAGE_BYTES if kind == "image" else MAX_VIDEO_BYTES


def validate_intent(*, kind: str, mime: str, size_bytes: int) -> UploadIntent:
    """Check an upload request before any storage is handed out.

    Raises `UploadRejectedError` with a message meant for the user. Cheap on
    purpose: this runs before a presigned URL exists, so a bad request costs
    nothing but a round trip.
    """
    if kind not in ALLOWED:
        raise UploadRejectedError(f"Unsupported kind: {kind!r}.")
    # `kind` is now known to be a key of ALLOWED, so it is a Kind.
    checked_kind: Kind = "image" if kind == "image" else "video"

    canonical = normalise_mime(mime)
    if canonical not in ALLOWED[checked_kind]:
        allowed = ", ".join(sorted(ALLOWED[checked_kind]))
        raise UploadRejectedError(
            f"{mime} is not an accepted {checked_kind} type. Accepted: {allowed}."
        )

    if size_bytes < MIN_BYTES:
        raise UploadRejectedError("That file is empty.")

    ceiling = max_bytes_for(checked_kind)
    if size_bytes > ceiling:
        raise UploadRejectedError(
            f"That {checked_kind} is {size_bytes // (1024 * 1024)}MB. "
            f"The limit is {ceiling // (1024 * 1024)}MB."
        )

    return UploadIntent(kind=checked_kind, mime=canonical, size_bytes=size_bytes)


def detect_mime(data: bytes) -> str | None:
    """What the bytes actually are, or None if nothing recognised them.

    `puremagic` rather than `python-magic`: libmagic is unavailable on this
    machine and its only Windows supplier is an unmaintained 2017 binary
    wheel. See `docs/VERSIONS.md` for the comparison that decided it. The
    practical difference is nil for our purposes — both identify every media
    type in the allowlist identically, and this is a first pass regardless.
    Pillow's `verify()` and `ffprobe` are what actually parse the file.

    Only the leading bytes are needed, so callers may pass a prefix.
    """
    try:
        matches = puremagic.magic_string(data)
    except puremagic.PureError:
        return None
    except ValueError:
        # puremagic raises this on empty input.
        return None

    for match in matches:
        if match.mime_type:
            return str(match.mime_type)
    return None


def reconcile_detected_mime(*, declared: str, detected: str | None, kind: Kind) -> str:
    """Decide whether the bytes match the claim. Returns the canonical type.

    Three ways to fail, and all three are the same attack from different
    angles:

    - the sniffer recognised nothing, so we have no positive evidence;
    - the sniffer recognised something outside the allowlist for this kind;
    - the sniffer disagreed with what the client said.

    Note the asymmetry: a detected type must be in the allowlist *for its
    kind*. An `image` intent whose bytes are really `video/mp4` is rejected
    even though video is otherwise acceptable, because the whole pipeline
    downstream was chosen on the strength of the declared kind.
    """
    canonical_declared = normalise_mime(declared)

    if detected is None:
        raise UploadRejectedError(
            "Could not identify that file. It may be corrupt or an unsupported format."
        )

    canonical_detected = normalise_mime(detected)

    if canonical_detected not in ALLOWED[kind]:
        if kind == "video" and canonical_detected.startswith("audio/"):
            raise UploadRejectedError(
                "That file contains audio but no video. "
                "Choose an MP4, MOV, or WebM file with a video track."
            )
        accepted = (
            "JPEG, PNG, WebP, or AVIF image"
            if kind == "image"
            else "MP4, MOV, or WebM video"
        )
        raise UploadRejectedError(
            f"That file is not a supported {kind}. Choose a {accepted}."
        )

    if canonical_detected != canonical_declared:
        raise UploadRejectedError(
            f"That file was declared {canonical_declared} but is really "
            f"{canonical_detected}."
        )

    return canonical_detected


def validate_image_dimensions(width: int, height: int) -> None:
    """Reject implausible geometry before allocating a decode buffer."""
    if width <= 0 or height <= 0:
        raise UploadRejectedError("That image has no dimensions.")
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise UploadRejectedError(
            f"That image is {width}x{height}. The limit is {MAX_DIMENSION}px on a side."
        )
    if width * height > MAX_PIXELS:
        raise UploadRejectedError("That image has too many pixels.")


def validate_video_duration(duration_ms: int) -> None:
    if duration_ms <= 0:
        raise UploadRejectedError("That video has no duration.")
    if duration_ms > MAX_VIDEO_DURATION_MS:
        raise UploadRejectedError(
            f"That video is {duration_ms // 1000}s. The limit is "
            f"{MAX_VIDEO_DURATION_MS // 1000}s."
        )


# ---------------------------------------------------------------------------
# Object keys
#
# Deterministic and derivable from the media id alone, so nothing about the
# derivatives needs a database column. `01-ARCHITECTURE.md` §5's media table
# has no `derivatives` field and this is why it does not need one.
# ---------------------------------------------------------------------------

#: Widths produced for every image. 640 is the feed column, 1080 covers a
#: 2x feed and the lightbox, 320 is the contact sheet.
DERIVATIVE_WIDTHS: Final[tuple[int, ...]] = (320, 640, 1080)

DERIVATIVE_FORMAT: Final = "webp"


def _prefix(media_id: int) -> str:
    """Shard by the low digits of the id.

    Snowflakes are time-ordered, so without this every upload in a given
    period lands in one prefix — which is exactly the hot-partition shape S3
    and its imitators are worst at.
    """
    return f"{media_id % 1000:03d}/{media_id}"


def object_key(media_id: int, mime: str) -> str:
    """Where the browser PUTs the original."""
    extension = EXTENSIONS.get(normalise_mime(mime), "bin")
    return f"{_prefix(media_id)}/original.{extension}"


def derivative_key(media_id: int, width: int) -> str:
    return f"{_prefix(media_id)}/w{width}.{DERIVATIVE_FORMAT}"


def poster_key(media_id: int) -> str:
    """First frame of a video, used as its still and its blurhash source."""
    return f"{_prefix(media_id)}/poster.{DERIVATIVE_FORMAT}"


def transcode_key(media_id: int) -> str:
    """720p H.264. One ffmpeg subprocess locally, Mux in production."""
    return f"{_prefix(media_id)}/720p.mp4"
