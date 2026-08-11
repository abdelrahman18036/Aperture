"""Views for the moderation app.

Thin by rule: parse the request, call a selector or a service, return.

There is exactly one endpoint, and it is the report button. Everything a
moderator does happens in the Django admin console — which is the whole reason
`01-ARCHITECTURE.md` chose Django, and why there is no bespoke moderation UI
to build here.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.auth import current_user
from moderation import services
from moderation.serializers import CreateReportSerializer, ReportSerializer
from moderation.throttling import ReportThrottle


class ReportView(APIView):
    """`POST /api/moderation/reports` — the report button.

    §11: "Build the report button before you build stories." This is that
    button's endpoint, and it shipped in the same phase as the queue behind it.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ReportThrottle]

    @extend_schema(
        operation_id="moderation_report",
        request=CreateReportSerializer,
        responses={201: ReportSerializer, 400: None, 429: None},
        description=(
            "Report a post, comment, user or piece of media. Idempotent per "
            "reporter per subject: reporting twice returns the first report."
        ),
    )
    def post(self, request: Request) -> Response:
        form = CreateReportSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        try:
            report = services.file_report(
                reporter=current_user(request),
                subject_type=form.validated_data["subject_type"],
                subject_id=int(form.validated_data["subject_id"]),
                reason=form.validated_data["reason"],
                note=form.validated_data["note"],
            )
        except (services.ReportRejectedError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(ReportSerializer(report).data, status=status.HTTP_201_CREATED)
