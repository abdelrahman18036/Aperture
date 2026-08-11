"""URL path converters.

Project-level plumbing, like `health.py` and `fields.py`. The eight-file
layout in `01-ARCHITECTURE.md` §2 governs apps, and `config/` is not one.
"""

from __future__ import annotations


class SnowflakeConverter:
    """A snowflake id in a URL path, carried as a **string**.

    Django's built-in `<int:>` converter would be the obvious choice and is
    the wrong one. drf-spectacular types an `<int:>` parameter as an OpenAPI
    integer, openapi-typescript turns that into a TypeScript `number`, and the
    call site then has to write `Number(id)` — which silently rounds, because
    snowflakes exceed 2^53.

    That is not hypothetical. It shipped, and the browser requested

        POST /api/media/80750720826998780/complete   -> 404

    for a row whose id ended in different digits. `config/fields.py` keeps ids
    out of JSON numbers; this keeps them out of path parameters, which is the
    same bug wearing a different hat.

    The regex still enforces digits, so a non-numeric path never reaches a
    view.
    """

    regex = r"[0-9]+"

    def to_python(self, value: str) -> str:
        return value

    def to_url(self, value: str | int) -> str:
        return str(value)
