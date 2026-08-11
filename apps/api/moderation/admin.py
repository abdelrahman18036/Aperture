"""Admin for the moderation app.

Phase 5 turns this into the moderation console -- the report queue with
`actions_row` for per-report decisions and `actions_list` for bulk, every one
of them gated by a `has_*_permission` method. Nothing to register yet.

Every class added here must inherit from `unfold.admin.ModelAdmin`. Inheriting
from `django.contrib.admin.ModelAdmin` does not error, it just renders
unstyled -- which is why Phase 5 greps for it.
"""
