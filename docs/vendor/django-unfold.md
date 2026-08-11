# django-unfold — working reference

Fetched from <https://unfoldadmin.com/docs/> on 2026-08-11. Version **0.104.0**.
Vendored because this library is thin in training data — work from this file, not from memory.

- Requires `django>=5.2` (its only dependency) and Python `>=3.12,<4`.
- Declares support for Django **5.2, 6.0, 6.1**. Our pin is Django 6.1 ✓ on Python 3.13.12 ✓.

## Install

```
uv add django-unfold
```

**`unfold` must come before `django.contrib.admin` in `INSTALLED_APPS`** — it overrides admin
templates, so load order is not optional:

```python
INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "unfold.contrib.inlines",
    "django.contrib.admin",
    ...
]
```

The other `unfold.contrib.*` entries (`import_export`, `guardian`, `simple_history`,
`location_field`, `constance`, `hijack`) are only needed if the matching third-party package is
installed. **We use none of them — do not add them.**

No URL configuration changes are needed beyond Django's standard admin setup.

## ModelAdmin

Every admin class must inherit from **`unfold.admin.ModelAdmin`**, not `django.contrib.admin.ModelAdmin`.
The docs are explicit: the default class "will result in unstyled forms and missing Unfold functionality."

```python
from django.contrib import admin
from unfold.admin import ModelAdmin

@admin.register(MyModel)
class MyModelAdmin(ModelAdmin):
    pass
```

This is the single easiest thing to get wrong — a half-migrated admin looks broken rather than
erroring. When Phase 5 lands, grep for `admin.ModelAdmin` and confirm zero hits.

## Actions — what the moderation queue needs

Unfold extends Django's `@action` decorator. Import from **`unfold.decorators`**, not `django.contrib.admin`.

Three placements, declared as list attributes on the ModelAdmin:

| Attribute | Where it renders |
|---|---|
| `actions_list` | top of the changelist — bulk actions |
| `actions_row` | per row in the results table |
| `actions_detail` | on the change form |

Extra decorator parameters beyond Django's: `url_path`, `attrs` (HTML attributes on the `<a>`),
`permissions`, and `variant` (`DEFAULT`, `PRIMARY`, `SUCCESS`, `INFO`, `WARNING`, `DANGER`).

`permissions=["foo"]` makes Unfold call `has_foo_permission(request)` — define it or the action
never appears.

```python
from django.contrib.admin import register
from django.http import HttpRequest
from django.shortcuts import redirect
from django.urls import reverse_lazy
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action


@register(Report)
class ReportAdmin(ModelAdmin):
    actions_row = ["dismiss"]

    @action(
        description=_("Dismiss report"),
        permissions=["dismiss"],
        url_path="dismiss",
    )
    def dismiss(self, request: HttpRequest, object_id: int):
        return redirect(reverse_lazy("admin:moderation_report_changelist"))

    def has_dismiss_permission(self, request: HttpRequest) -> bool:
        return request.user.is_staff
```

Row action methods receive `(self, request, object_id)`.

## UNFOLD settings dict

Keys worth knowing:

| Key | Controls |
|---|---|
| `SITE_TITLE`, `SITE_HEADER`, `SITE_SUBHEADER` | title tag and sidebar text |
| `SITE_ICON`, `SITE_LOGO` | accept either one image or `{"light": ..., "dark": ...}` |
| `SIDEBAR` | `show_search`, `show_all_applications`, collapsible nav groups with icons and badges |
| `THEME` | force `"dark"` or `"light"`, disabling the switcher |
| `COLORS` | base / primary / font palettes, light and dark variants — **OKLCH values** |
| `BORDER_RADIUS` | e.g. `"6px"` |
| `SHOW_HISTORY`, `SHOW_VIEW_ON_SITE`, `SHOW_BACK_BUTTON`, `SHOW_UI_WARNINGS` | button toggles |
| `DASHBOARD_CALLBACK` | variables for a custom dashboard template |
| `LOGIN` | login page image, redirect, custom form class |
| `STYLES`, `SCRIPTS` | extra static files |
| `TABS` | tabbed navigation on change forms |
| `ENVIRONMENT` | callback showing an environment banner in the header |

## Our configuration policy

`COLORS` takes OKLCH, which is the same color space as `02-DESIGN-SYSTEM.md`. That makes a light
touch of theming nearly free — so take it, and then **stop**:

```python
UNFOLD = {
    "SITE_TITLE": "Aperture",
    "SITE_HEADER": "Aperture",
    "THEME": "dark",
    "BORDER_RADIUS": "6px",
    "COLORS": {"primary": {...}},   # safelight ramp from the design system
    "SHOW_UI_WARNINGS": True,       # dev only
}
```

Beyond that: **the admin is a tool, not a design surface.** No custom dashboard, no `STYLES`
overrides, no bespoke templates. Effort spent making the admin beautiful is effort not spent on
the product, and Unfold's defaults are already good.

`ENVIRONMENT` is worth setting once production exists — a red banner on prod is cheap insurance
against acting on the wrong database.

## Sources

- <https://unfoldadmin.com/docs/installation/quickstart/>
- <https://unfoldadmin.com/docs/configuration/settings/>
- <https://unfoldadmin.com/docs/actions/changelist-row/>
- <https://unfoldadmin.com/docs/decorators/action/>
- <https://github.com/unfoldadmin/django-unfold>
