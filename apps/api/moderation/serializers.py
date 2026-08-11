"""DRF shapes for the moderation app.

Shapes only. A serializer containing an `if` is logic that belongs in a
selector or a service.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from config.fields import SnowflakeField
from moderation.models import Report


class ReportSerializer(serializers.ModelSerializer[Report]):
    """A report, as the person who filed it may see it.

    Deliberately thin: the reporter learns that their report exists and
    nothing about what happened next. Telling them the outcome would tell them
    whether the person they reported was actioned, which is a privacy leak
    about a third party and, when the reporter is the harasser, a feedback
    signal for tuning the next attempt.
    """

    id = SnowflakeField(read_only=True)
    subject_id = SnowflakeField(read_only=True)

    class Meta:
        model = Report
        fields = ("id", "subject_type", "subject_id", "reason", "created_at")
        read_only_fields = fields


class CreateReportSerializer(serializers.Serializer[dict[str, Any]]):
    subject_type = serializers.ChoiceField(choices=Report.Subject.choices)
    subject_id = serializers.CharField()
    reason = serializers.ChoiceField(choices=Report.Reason.choices)
    note = serializers.CharField(
        max_length=1000, allow_blank=True, required=False, default=""
    )
