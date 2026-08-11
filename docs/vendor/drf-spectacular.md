# drf-spectacular — vendored reference

Fetched 2026-08-11 from <https://drf-spectacular.readthedocs.io/en/latest/readme.html>.
Pinned version for this project: **0.30.0** (`docs/VERSIONS.md`).

This is the generator half of the type boundary in `01-ARCHITECTURE.md` §3. Work from this file,
not from memory.

> ⚠️ **Compatibility to verify at install time.** The upstream readme advertises Django 3.2–6.0 and
> DRF 3.12–3.17. We pin **Django 6.1** and **DRF 3.18.0**, both one minor ahead of that matrix. The
> readme trails releases, so this is expected to work — but Phase 1 must prove it by generating a
> schema, not assume it. If `manage.py spectacular --validate --fail-on-warn` fails on a framework
> incompatibility rather than on our own serializers, that is a finding for the handoff.

---

## Install

```bash
uv add drf-spectacular
```

`INSTALLED_APPS`:

```python
INSTALLED_APPS = [
    # ALL YOUR APPS
    'drf_spectacular',
]
```

The optional sidecar package vendors the Swagger UI / ReDoc static assets so the docs pages work
without CDN access:

```python
INSTALLED_APPS = [
    'drf_spectacular',
    'drf_spectacular_sidecar',
]
```

## Settings

Register the AutoSchema as DRF's default — without this, nothing is generated:

```python
REST_FRAMEWORK = {
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}
```

Metadata:

```python
SPECTACULAR_SETTINGS = {
    'TITLE': 'Your Project API',
    'DESCRIPTION': 'Your project description',
    'VERSION': '1.0.0',
    'SERVE_INCLUDE_SCHEMA': False,
}
```

With sidecar:

```python
SPECTACULAR_SETTINGS = {
    'SWAGGER_UI_DIST': 'SIDECAR',
    'SWAGGER_UI_FAVICON_HREF': 'SIDECAR',
    'REDOC_DIST': 'SIDECAR',
}
```

## URLs

```python
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView
)

urlpatterns = [
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/schema/swagger-ui/',
         SpectacularSwaggerView.as_view(url_name='schema'),
         name='swagger-ui'),
    path('api/schema/redoc/',
         SpectacularRedocView.as_view(url_name='schema'),
         name='redoc'),
]
```

## The management command — this is the pipeline entry point

```bash
./manage.py spectacular --color --file schema.yml
./manage.py spectacular --file schema.json --format openapi-json
./manage.py spectacular --validate --fail-on-warn
```

`--format openapi-json` is the one we want: `openapi-typescript` consumes JSON, and a JSON artifact
diffs more usefully in CI than YAML. `--validate --fail-on-warn` is what makes rule 7 ("CI fails on
drift") bite — a serializer that generates a warning fails the build rather than silently emitting a
loose `unknown` into `packages/api-client`.

## Resolving warnings

Every warning is an untyped hole in the generated client. Fix them at the source rather than
suppressing them.

`@extend_schema` — customize a view:

```python
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample
from drf_spectacular.types import OpenApiTypes

@extend_schema(
    request=AlbumCreationSerializer,
    responses={201: AlbumSerializer},
    parameters=[
        OpenApiParameter(name='artist', description='Filter by artist',
                        required=False, type=str),
    ],
    description='Custom description',
    auth=None,
    operation_id=None,
)
def create(self, request):
    return super().create(request)
```

`@extend_schema_field` — the fix for `SerializerMethodField`, which is otherwise untypable and the
single most common source of warnings:

```python
from drf_spectacular.utils import extend_schema_field

@extend_schema_field(OpenApiTypes.STR)
def get_custom_field(self, obj):
    return str(obj)
```

`@extend_schema_view` — applies per-method `@extend_schema` decorators to a ViewSet from the outside,
so the view class stays thin (rule 2).

## Requirements as published

- Python ≥ 3.8 (we run 3.13.12)
- Django 3.2 – 6.0 (we run 6.1 — see the compatibility note above)
- Django REST Framework 3.12 – 3.17 (we run 3.18.0 — same)
