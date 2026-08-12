"""The moderation console.

This is where the stack choice pays. `01-ARCHITECTURE.md` §11 and the Phase 5
brief both say it outright: the report queue, the row actions and the
permission gating come essentially free from Django admin plus django-unfold,
and that is most of what the Django decision bought.

Every class here inherits from `unfold.admin.ModelAdmin`. Django's own
`ModelAdmin` does not error — it renders unstyled, which looks broken rather
than failing loudly — so the phase verification greps for it and expects zero
hits. See `docs/vendor/django-unfold.md`.

**The admin is a tool, not a design surface.** No custom dashboard, no STYLES
overrides, no bespoke templates. What is here is what a moderator needs in
order to decide in one click.
"""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect
from django.urls import reverse_lazy
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import action

from moderation import services
from moderation.models import Report
from users.models import User


class AwaitingEscalation(admin.SimpleListFilter):
    """CSAM reports that have not been forwarded.

    `moderation.report_escalation_backlog` counts these hourly and logs at
    CRITICAL, which is the right alarm and the wrong place to work from — a
    number in a log names no rows. This is the same query as a filter, so a
    moderator can see *which* reports are outstanding and an operator who has
    just wired a provider can check the queue drained.
    """

    title = _("escalation")
    parameter_name = "escalation"

    def lookups(
        self,
        request: HttpRequest,
        model_admin: Any,
    ) -> list[tuple[str, Any]]:
        # `Any` on the label: `gettext_lazy` returns a promise rather than a
        # `str`, and django-stubs types this return as plain strings.
        return [
            ("awaiting", _("CSAM, not yet forwarded")),
            ("done", _("CSAM, forwarded")),
        ]

    def queryset(
        self, request: HttpRequest, queryset: QuerySet[Report]
    ) -> QuerySet[Report]:
        if self.value() == "awaiting":
            return queryset.filter(reason=Report.Reason.CSAM, escalated_at__isnull=True)
        if self.value() == "done":
            return queryset.filter(
                reason=Report.Reason.CSAM, escalated_at__isnull=False
            )
        return queryset


@admin.register(Report)
class ReportAdmin(ModelAdmin):
    """The queue.

    A moderator's job here is to look at one row and decide. Everything on the
    changelist serves that: what was reported, why, who owns it, who said so.
    """

    list_display = (
        "severity",
        "subject_label",
        "reason",
        "owner_label",
        "reporter_label",
        "status",
        "created_at",
        "escalated_at",
    )
    list_filter = ("status", "reason", "subject_type", AwaitingEscalation)
    search_fields = (
        "subject_id",
        "note",
        "subject_owner__username",
        "reporter__username",
    )
    ordering = ("-id",)
    date_hierarchy = "created_at"
    list_per_page = 50

    readonly_fields = (
        "id",
        "reporter",
        "subject_type",
        "subject_id",
        "subject_owner",
        "reason",
        "note",
        "created_at",
        "resolved_by",
        "resolved_at",
        "escalated_at",
    )

    # Per-row decisions, so the common case is one click from the queue.
    actions_row = ["dismiss_report", "remove_content", "suspend_account"]
    # Bulk, for when one piece of content drew fifty reports.
    actions_list = ["dismiss_selected"]

    # ---------------------------------------------------------------- display

    @admin.display(description=_("!"), ordering="reason")
    def severity(self, report: Report) -> str:
        """CSAM is visually unmissable. Everything else is plain text.

        The one place in this project where colour is emphasis rather than
        meaning, and it earns it.
        """
        if report.is_csam:
            # Django 6.1 removed `format_html` with no interpolation
            # arguments, so the label is passed in rather than inlined.
            return format_html(
                '<span style="color:oklch(0.640 0.190 25);font-weight:600">{}</span>',
                "CSAM",
            )
        return ""

    @admin.display(description=_("Subject"))
    def subject_label(self, report: Report) -> str:
        return f"{report.subject_type}:{report.subject_id}"

    @admin.display(description=_("Owner"))
    def owner_label(self, report: Report) -> str:
        return report.subject_owner.username if report.subject_owner else "—"

    @admin.display(description=_("Reported by"))
    def reporter_label(self, report: Report) -> str:
        if report.reporter is None:
            return "automated"
        return report.reporter.username

    # ------------------------------------------------------------ permissions

    def has_add_permission(self, request: HttpRequest) -> bool:
        """Reports come from users and from scanning, never from this form."""
        return False

    def has_delete_permission(
        self, request: HttpRequest, obj: Report | None = None
    ) -> bool:
        """The queue is an audit trail. Resolving is not deleting."""
        return False

    # Unfold calls `has_<name>_permission` for each action's `permissions`
    # entry and hides the control when it returns False. §11 asks for gating on
    # every one, so every one has its own method rather than a shared default.

    def has_dismiss_permission(self, request: HttpRequest) -> bool:
        return bool(request.user.is_staff)

    def has_remove_permission(self, request: HttpRequest) -> bool:
        return bool(request.user.is_staff)

    def has_suspend_permission(self, request: HttpRequest) -> bool:
        """Suspension takes an account away, so it asks for more than staff."""
        return bool(request.user.is_superuser)

    # ---------------------------------------------------------------- actions

    @staticmethod
    def _moderator(request: HttpRequest) -> User:
        """Narrow `request.user` for the type checker.

        The admin is behind `is_staff`, so this is always a real user; Django
        types it as the union anyway.
        """
        user = request.user
        if not isinstance(user, User):  # pragma: no cover - admin is gated
            raise PermissionError("moderation actions require a signed-in user")
        return user

    def _resolve(
        self, request: HttpRequest, object_id: int, action_name: str
    ) -> HttpResponse:
        report = Report.objects.filter(pk=object_id).first()
        if report is not None:
            services.resolve(
                report=report,
                moderator=self._moderator(request),
                action=action_name,
                note=f"{action_name} from the console",
            )
        return redirect(reverse_lazy("admin:moderation_report_changelist"))

    @action(description=_("Dismiss"), permissions=["dismiss"], url_path="dismiss")
    def dismiss_report(self, request: HttpRequest, object_id: int) -> HttpResponse:
        return self._resolve(request, object_id, "dismiss")

    @action(description=_("Remove content"), permissions=["remove"], url_path="remove")
    def remove_content(self, request: HttpRequest, object_id: int) -> HttpResponse:
        return self._resolve(request, object_id, "remove")

    @action(
        description=_("Suspend account"), permissions=["suspend"], url_path="suspend"
    )
    def suspend_account(self, request: HttpRequest, object_id: int) -> HttpResponse:
        return self._resolve(request, object_id, "suspend")

    @action(description=_("Dismiss selected"), permissions=["dismiss"])
    def dismiss_selected(
        self, request: HttpRequest, queryset: QuerySet[Report]
    ) -> None:
        for report in queryset.filter(status=Report.Status.OPEN):
            services.resolve(
                report=report,
                moderator=self._moderator(request),
                action="dismiss",
                note="bulk dismiss from the console",
            )
