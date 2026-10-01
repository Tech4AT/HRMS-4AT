"""The team/org-wide learning lists honour RBAC scoping (core conformance
kit). The rows are LMS projections, never created through HRMS, so there is
no create check (create_payload is None)."""

from django.utils import timezone

from core.conformance import ScopedEndpoint
from lms_integration.models import EmployeeCertification

ENDPOINT = ScopedEndpoint(
    label="LMS certifications",
    list_url="/api/v1/integrations/lms/certifications/",
    detail_url=lambda pk: f"/api/v1/integrations/lms/certifications/{pk}/",
    read_permission="lms.read",
    create_record=lambda employee: EmployeeCertification.objects.create(
        employee=employee,
        certification_id=f"cert-{employee.pk}",
        name="Security Awareness",
        source_occurred_at=timezone.now(),
    ).pk,
    owner_of=lambda row: row["employee"],
)
