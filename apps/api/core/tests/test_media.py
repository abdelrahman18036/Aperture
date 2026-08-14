"""Tests for `core.media`.

The interesting cases are all adversarial. A file that is what it says it is
needs one test; a file that lies needs several.
"""

from __future__ import annotations

import pytest

from core.media import (
    MAX_IMAGE_BYTES,
    MAX_VIDEO_DURATION_MS,
    UploadRejectedError,
    derivative_key,
    normalise_mime,
    object_key,
    poster_key,
    reconcile_detected_mime,
    transcode_key,
    validate_image_dimensions,
    validate_intent,
    validate_video_duration,
)


class TestNormaliseMime:
    @pytest.mark.parametrize(
        ("given", "expected"),
        [
            ("image/jpeg", "image/jpeg"),
            ("IMAGE/JPEG", "image/jpeg"),
            ("image/jpg", "image/jpeg"),
            ("image/pjpeg", "image/jpeg"),
            ("image/jpeg; charset=binary", "image/jpeg"),
            ("  image/png  ", "image/png"),
            ("video/mov", "video/quicktime"),
        ],
    )
    def test_resolves_the_aliases_real_clients_send(
        self, given: str, expected: str
    ) -> None:
        assert normalise_mime(given) == expected


class TestValidateIntent:
    def test_accepts_an_ordinary_photo(self) -> None:
        intent = validate_intent(kind="image", mime="image/jpg", size_bytes=4_000_000)
        assert intent.kind == "image"
        assert intent.mime == "image/jpeg"

    def test_rejects_an_unknown_kind(self) -> None:
        with pytest.raises(UploadRejectedError):
            validate_intent(kind="audio", mime="audio/mpeg", size_bytes=1000)

    def test_rejects_a_type_outside_the_allowlist(self) -> None:
        # Deny by default: SVG is an image, and it is also a script host.
        with pytest.raises(UploadRejectedError, match="not an accepted image type"):
            validate_intent(kind="image", mime="image/svg+xml", size_bytes=1000)

    def test_rejects_a_video_type_declared_as_an_image(self) -> None:
        with pytest.raises(UploadRejectedError):
            validate_intent(kind="image", mime="video/mp4", size_bytes=1000)

    def test_rejects_an_empty_file(self) -> None:
        with pytest.raises(UploadRejectedError, match="empty"):
            validate_intent(kind="image", mime="image/jpeg", size_bytes=0)

    def test_rejects_a_file_over_the_ceiling(self) -> None:
        with pytest.raises(UploadRejectedError, match="limit"):
            validate_intent(
                kind="image", mime="image/jpeg", size_bytes=MAX_IMAGE_BYTES + 1
            )

    def test_accepts_a_file_exactly_at_the_ceiling(self) -> None:
        intent = validate_intent(
            kind="image", mime="image/jpeg", size_bytes=MAX_IMAGE_BYTES
        )
        assert intent.size_bytes == MAX_IMAGE_BYTES

    def test_the_brief_s_twelve_megabyte_jpeg_is_fine(self) -> None:
        assert validate_intent(
            kind="image", mime="image/jpeg", size_bytes=12 * 1024 * 1024
        )


class TestReconcileDetectedMime:
    def test_accepts_a_file_that_is_what_it_claims(self) -> None:
        assert (
            reconcile_detected_mime(
                declared="image/jpeg", detected="image/jpeg", kind="image"
            )
            == "image/jpeg"
        )

    def test_accepts_across_an_alias(self) -> None:
        assert (
            reconcile_detected_mime(
                declared="image/jpg", detected="image/jpeg", kind="image"
            )
            == "image/jpeg"
        )

    def test_rejects_the_first_attack_you_will_see(self) -> None:
        """A declared image/jpeg whose bytes are something else entirely."""
        with pytest.raises(UploadRejectedError, match="supported image"):
            reconcile_detected_mime(
                declared="image/jpeg", detected="application/x-dosexec", kind="image"
            )

    def test_rejects_an_image_that_is_really_a_video(self) -> None:
        # Acceptable as a video, but the whole pipeline downstream was chosen
        # on the strength of the declared kind.
        with pytest.raises(UploadRejectedError):
            reconcile_detected_mime(
                declared="image/jpeg", detected="video/mp4", kind="image"
            )

    def test_rejects_one_allowed_image_type_masquerading_as_another(self) -> None:
        with pytest.raises(UploadRejectedError, match="declared"):
            reconcile_detected_mime(
                declared="image/jpeg", detected="image/png", kind="image"
            )

    def test_rejects_when_nothing_could_be_detected(self) -> None:
        # No positive evidence is not the same as no evidence against.
        with pytest.raises(UploadRejectedError, match="identify"):
            reconcile_detected_mime(declared="image/jpeg", detected=None, kind="image")

    def test_rejects_svg_even_though_a_sniffer_calls_it_an_image(self) -> None:
        with pytest.raises(UploadRejectedError):
            reconcile_detected_mime(
                declared="image/svg+xml", detected="image/svg+xml", kind="image"
            )

    def test_explains_audio_disguised_as_video_without_mime_jargon(self) -> None:
        with pytest.raises(UploadRejectedError) as rejected:
            reconcile_detected_mime(
                declared="video/mp4", detected="audio/x-sndr", kind="video"
            )
        assert str(rejected.value) == (
            "That file contains audio but no video. "
            "Choose an MP4, MOV, or WebM file with a video track."
        )


class TestDimensionAndDurationGuards:
    def test_accepts_an_ordinary_photo(self) -> None:
        validate_image_dimensions(1080, 1350)

    @pytest.mark.parametrize(("w", "h"), [(0, 100), (100, 0), (-1, 10)])
    def test_rejects_degenerate_geometry(self, w: int, h: int) -> None:
        with pytest.raises(UploadRejectedError):
            validate_image_dimensions(w, h)

    def test_rejects_an_absurdly_long_side(self) -> None:
        with pytest.raises(UploadRejectedError, match="on a side"):
            validate_image_dimensions(50_000, 10)

    def test_rejects_a_decompression_bomb_by_pixel_count(self) -> None:
        # Under the per-side limit, far over the total. A few hundred KB of
        # PNG can claim this.
        with pytest.raises(UploadRejectedError, match="too many pixels"):
            validate_image_dimensions(11_000, 11_000)

    def test_accepts_a_thirty_second_clip(self) -> None:
        validate_video_duration(30_000)

    def test_rejects_an_over_long_video(self) -> None:
        with pytest.raises(UploadRejectedError):
            validate_video_duration(MAX_VIDEO_DURATION_MS + 1)


class TestObjectKeys:
    def test_original_key_carries_the_right_extension(self) -> None:
        assert object_key(80728620347162624, "image/jpg").endswith("/original.jpg")
        assert object_key(80728620347162624, "video/quicktime").endswith(
            "/original.mov"
        )

    def test_keys_are_derivable_from_the_id_alone(self) -> None:
        """Which is why the media table needs no `derivatives` column."""
        media_id = 80728620347162624
        keys = {
            object_key(media_id, "image/jpeg"),
            derivative_key(media_id, 320),
            derivative_key(media_id, 640),
            derivative_key(media_id, 1080),
            poster_key(media_id),
            transcode_key(media_id),
        }
        assert len(keys) == 6
        assert all(key.startswith("624/80728620347162624/") for key in keys)

    def test_ids_close_in_time_land_in_different_prefixes(self) -> None:
        """Snowflakes are time-ordered, so an unsharded prefix would be hot."""
        prefixes = {
            object_key(80728620347162624 + n, "image/jpeg").split("/", 1)[0]
            for n in range(50)
        }
        assert len(prefixes) > 1
