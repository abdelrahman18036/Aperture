"""Serializer fields shared by every app.

Project-level for the same reason `health.py` is: this is plumbing that
belongs to no aggregate. The eight-file layout in `01-ARCHITECTURE.md` §2
governs apps, and `config/` is not one.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers


@extend_schema_field(OpenApiTypes.STR)
class SnowflakeField(serializers.Field[int, str, str, Any]):
    """A 64-bit snowflake id, serialized as a **string**.

    This is not cosmetic. Snowflakes run to about 8e16; JavaScript numbers
    are IEEE-754 doubles and lose integer precision above 2^53 ≈ 9e15. Sent
    as a JSON number, `80728620347162624` arrives in the browser as
    `80728620347162624` — but `80728620347162625` arrives as
    `80728620347162624` too, and the bug that produces is a like landing on
    the wrong post, once in a while, unreproducibly.

    `JSON.parse` has no hook to prevent this, so the fix has to be on the
    wire. Every id crossing the boundary is a string, and the generated
    TypeScript client types it as one.
    """

    def to_representation(self, value: int) -> str:
        return str(value)

    def to_internal_value(self, data: object) -> int:
        try:
            return int(str(data))
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError("Not a valid id.") from exc
