"""Admin for the users app.

The admin is a staff tool, not a design surface. Registration, sensible list
columns, and stop.

Every class here inherits from `unfold.admin.ModelAdmin`. Django's own
`ModelAdmin` does not error — it renders unstyled, which looks broken rather
than failing loudly. See `docs/vendor/django-unfold.md`.
"""

from __future__ import annotations

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from users.models import Block, Follow, User


@admin.register(User)
class UserAdmin(DjangoUserAdmin, ModelAdmin):  # type: ignore[type-arg]
    """Fieldsets are spelled out because this model drops AbstractUser's
    `first_name` / `last_name` in favour of a single `display_name`, and the
    inherited fieldsets reference fields that no longer exist."""

    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm

    list_display = ("username", "email", "display_name", "is_private", "created_at")
    list_filter = ("is_private", "is_staff", "is_superuser", "is_active")
    search_fields = ("username", "email", "display_name")
    ordering = ("-id",)
    readonly_fields = ("id", "created_at", "deleted_at", "last_login")

    fieldsets = (
        (None, {"fields": ("id", "email", "password")}),
        ("Profile", {"fields": ("username", "display_name", "bio", "avatar_media")}),
        ("Privacy", {"fields": ("is_private",)}),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
        ("Dates", {"fields": ("last_login", "created_at", "deleted_at")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "username",
                    "usable_password",
                    "password1",
                    "password2",
                ),
            },
        ),
    )


@admin.register(Follow)
class FollowAdmin(ModelAdmin):
    list_display = ("follower", "followee", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("follower__username", "followee__username")
    ordering = ("-id",)
    autocomplete_fields = ("follower", "followee")


@admin.register(Block)
class BlockAdmin(ModelAdmin):
    list_display = ("blocker", "blocked", "created_at")
    search_fields = ("blocker__username", "blocked__username")
    ordering = ("-id",)
    autocomplete_fields = ("blocker", "blocked")
