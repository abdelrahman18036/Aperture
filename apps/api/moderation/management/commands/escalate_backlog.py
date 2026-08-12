"""Push every un-escalated CSAM report through the NCMEC path.

    manage.py escalate_backlog --dry-run
    manage.py escalate_backlog

**This is the command you run the day a provider is wired.** Until
`NCMEC_REPORTING_ENABLED` is on with a real `NCMEC_BACKEND`, escalation logs
at CRITICAL and deliberately leaves `escalated_at` unset — so every report
filed before that day is sitting in a backlog, correctly marked as not having
gone anywhere. Nothing else in the system will ever pick them up: the task
runs once per report at the moment it is filed.

Runs the task inline rather than enqueuing, so failures are visible here
instead of in a worker log, and so an operator watching the output knows when
it is done. `escalate_csam_report` is idempotent — a report already stamped
returns `already-escalated` — which is what makes re-running this safe.
"""

from __future__ import annotations

import argparse
from typing import Any

from django.core.management.base import BaseCommand

from moderation import selectors
from moderation.tasks import escalate_csam_report


class Command(BaseCommand):
    help = "Retry NCMEC escalation for every CSAM report awaiting it."

    def add_arguments(self, parser: argparse.ArgumentParser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List what would be filed without filing anything.",
        )

    def handle(self, *args: Any, **options: Any) -> None:
        pending = list(selectors.pending_escalations())

        if not pending:
            self.stdout.write(self.style.SUCCESS("Nothing awaiting escalation."))
            return

        self.stdout.write(f"{len(pending)} report(s) awaiting escalation.")

        if options["dry_run"]:
            for report in pending:
                self.stdout.write(
                    f"  would file report {report.pk} "
                    f"({report.subject_type}:{report.subject_id})"
                )
            return

        filed = 0
        failed = 0
        for report in pending:
            try:
                outcome = escalate_csam_report(report.pk)
            except Exception as exc:
                # One refusal must not strand the rest of the queue, and the
                # report stays un-escalated so the next run picks it up again.
                failed += 1
                self.stderr.write(f"  report {report.pk} failed: {exc}")
                continue

            if outcome == "escalated":
                filed += 1
            self.stdout.write(f"  report {report.pk}: {outcome}")

        if failed:
            self.stdout.write(
                self.style.WARNING(f"Filed {filed}, {failed} still outstanding.")
            )
        else:
            self.stdout.write(self.style.SUCCESS(f"Filed {filed}."))
