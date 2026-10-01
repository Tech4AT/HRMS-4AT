"""Read-side aggregates over the projections: the per-employee learning
summary (Employee 360 -> Learning) and the scoped compliance view
(HR Dashboard -> Learning)."""

from datetime import timedelta

from django.db.models import Count, Q
from django.utils import timezone

from lms_integration.models import (
    AssessmentResult,
    CertificationStatus,
    EmployeeCertification,
    EmployeeSkill,
    LearningEnrollment,
    LearningStatus,
    LmsIdentityLink,
)

EXPIRY_WINDOW_DAYS = 30


def _pct(part, whole):
    return round(100 * part / whole) if whole else 0


def certification_state(cert, now=None):
    """The status HRMS shows. An LMS 'active' certificate whose expiry has
    passed (or is inside the window) is shown as expired/expiring even if the
    LMS has not sent the corresponding event yet (UAT-08)."""
    now = now or timezone.now()
    if cert.status == CertificationStatus.REVOKED:
        return CertificationStatus.REVOKED
    if cert.expires_at:
        if cert.expires_at <= now:
            return CertificationStatus.EXPIRED
        if cert.expires_at <= now + timedelta(days=EXPIRY_WINDOW_DAYS):
            return CertificationStatus.EXPIRING
    return cert.status


def link_data(employee):
    link = LmsIdentityLink.objects.filter(employee=employee).first()
    if link is None:
        return {
            "status": "not_linked",
            "learner_id": None,
            "linked_at": None,
            "last_synced_at": None,
        }
    return {
        "status": link.status,
        "learner_id": link.learner_id,
        "linked_at": link.linked_at,
        "last_synced_at": link.last_synced_at,
    }


def learning_summary(employee) -> dict:
    now = timezone.now()
    enrollments = list(LearningEnrollment.objects.filter(employee=employee))
    completed = [e for e in enrollments if e.status == LearningStatus.COMPLETED]
    open_items = [e for e in enrollments if e.status != LearningStatus.COMPLETED]
    mandatory = [e for e in enrollments if e.mandatory]
    certs = list(EmployeeCertification.objects.filter(employee=employee))
    states = [certification_state(c, now) for c in certs]

    paths = {}
    for e in enrollments:
        if not e.path_id:
            continue
        path = paths.setdefault(
            e.path_id, {"path_id": e.path_id, "name": e.path_name, "total": 0, "completed": 0}
        )
        path["total"] += 1
        path["completed"] += e.status == LearningStatus.COMPLETED
    for path in paths.values():
        path["progress"] = _pct(path["completed"], path["total"])

    return {
        "link": link_data(employee),
        "courses": {
            "assigned": len(enrollments),
            "in_progress": sum(e.status == LearningStatus.IN_PROGRESS for e in enrollments),
            "completed": len(completed),
            "overdue": sum(1 for e in open_items if e.due_at and e.due_at < now),
            "completion_rate": _pct(len(completed), len(enrollments)),
        },
        "mandatory": {
            "total": len(mandatory),
            "completed": sum(e.status == LearningStatus.COMPLETED for e in mandatory),
            "outstanding": sum(e.status != LearningStatus.COMPLETED for e in mandatory),
            "progress": _pct(
                sum(e.status == LearningStatus.COMPLETED for e in mandatory), len(mandatory)
            ),
        },
        "learning_paths": sorted(paths.values(), key=lambda p: p["name"] or p["path_id"]),
        "assessments": {
            "taken": AssessmentResult.objects.filter(employee=employee).count(),
            "passed": AssessmentResult.objects.filter(
                employee=employee, status__iexact="passed"
            ).count(),
        },
        "certifications": {
            "total": len(certs),
            "active": states.count(CertificationStatus.ACTIVE),
            "expiring": states.count(CertificationStatus.EXPIRING),
            "expired": states.count(CertificationStatus.EXPIRED),
        },
        "skills": EmployeeSkill.objects.filter(employee=employee).count(),
    }


def compliance_overview(employee_qs) -> dict:
    """HR Dashboard -> Learning, over whichever employees the caller may see."""
    now = timezone.now()
    ids = employee_qs.values("pk")
    enrollments = LearningEnrollment.objects.filter(employee_id__in=ids)
    totals = enrollments.aggregate(
        assigned=Count("id"),
        completed=Count("id", filter=Q(status=LearningStatus.COMPLETED)),
        mandatory_total=Count("id", filter=Q(mandatory=True)),
        mandatory_completed=Count("id", filter=Q(mandatory=True, status=LearningStatus.COMPLETED)),
        overdue=Count("id", filter=~Q(status=LearningStatus.COMPLETED) & Q(due_at__lt=now)),
    )
    window = now + timedelta(days=EXPIRY_WINDOW_DAYS)
    expiring = (
        EmployeeCertification.objects.filter(employee_id__in=ids, expires_at__lte=window)
        .exclude(status=CertificationStatus.REVOKED)
        .select_related("employee", "employee__department")
        .order_by("expires_at")[:100]
    )
    by_department = {}
    for row in enrollments.values("employee__department__name").annotate(
        assigned=Count("id"), completed=Count("id", filter=Q(status=LearningStatus.COMPLETED))
    ):
        name = row["employee__department__name"] or "Unassigned"
        by_department[name] = {
            "department": name,
            "assigned": row["assigned"],
            "completed": row["completed"],
            "completion_rate": _pct(row["completed"], row["assigned"]),
        }
    headcount = employee_qs.filter(status__in=("active", "on_leave")).count()
    linked = LmsIdentityLink.objects.filter(employee_id__in=ids, status="linked").count()
    return {
        "headcount": headcount,
        "linked_learners": linked,
        "courses": {**totals, "completion_rate": _pct(totals["completed"], totals["assigned"])},
        "mandatory_compliance": _pct(totals["mandatory_completed"], totals["mandatory_total"]),
        "by_department": sorted(by_department.values(), key=lambda d: d["department"]),
        "expiring_certifications": [
            {
                "employee_id": c.employee_id,
                "employee_code": c.employee.employee_code,
                "employee_name": c.employee.full_name,
                "department": c.employee.department.name if c.employee.department else None,
                "certification_id": c.certification_id,
                "name": c.name,
                "expires_at": c.expires_at,
                "status": certification_state(c, now),
            }
            for c in expiring
        ],
    }
