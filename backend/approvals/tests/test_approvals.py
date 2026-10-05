"""Conformance for the approvals lifecycle at the service layer: manager-derived
approver, the approver-only decision rule, and terminal-state immutability."""

import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.models import User
from approvals import service
from approvals.models import RequestStatus
from employees.models import Employee


def _user(email):
    return User.objects.create_user(username=email, email=email, password="Verify@12345")


@pytest.mark.django_db
def test_request_routes_to_manager_and_only_approver_decides():
    manager = _user("m@x.com")
    mgr_emp = Employee.objects.create(user=manager, employee_code="M1")
    requester = _user("r@x.com")
    Employee.objects.create(user=requester, employee_code="R1", manager=mgr_emp)

    req = service.create_request(requester, "leave", {"days": 1})
    assert req.approver_id == manager.pk

    # The requester is not the approver.
    with pytest.raises(PermissionDenied):
        service.decide(req, requester, RequestStatus.APPROVED)

    service.decide(req, manager, RequestStatus.APPROVED, "ok")
    req.refresh_from_db()
    assert req.status == RequestStatus.APPROVED

    # Terminal states never move again.
    with pytest.raises(ValidationError):
        service.decide(req, manager, RequestStatus.REJECTED)


@pytest.mark.django_db
def test_no_manager_leaves_it_unassigned_for_reassignment():
    requester = _user("o@x.com")
    Employee.objects.create(user=requester, employee_code="O1")  # no manager
    req = service.create_request(requester, "leave", {})
    assert req.approver_id is None

    hr = _user("hr@x.com")
    service.reassign(req, hr)
    req.refresh_from_db()
    assert req.approver_id == hr.pk


@pytest.mark.django_db
def test_request_decided_signal_fires_once_with_final_state():
    """A module (leave/attendance) reacts to a decision via request_decided."""
    from approvals.signals import request_decided

    manager = _user("sm@x.com")
    mgr_emp = Employee.objects.create(user=manager, employee_code="SM1")
    requester = _user("sr@x.com")
    Employee.objects.create(user=requester, employee_code="SR1", manager=mgr_emp)

    seen = []
    request_decided.connect(
        lambda sender, request, actor, status, **kw: seen.append(status), weak=False
    )

    req = service.create_request(requester, "leave", {"days": 2})
    assert seen == []  # not fired on create

    service.decide(req, manager, RequestStatus.APPROVED, "ok")
    assert seen == [RequestStatus.APPROVED]  # fired once, with final status
    req.refresh_from_db()
    assert req.status == RequestStatus.APPROVED


@pytest.mark.django_db
def test_request_decided_fires_on_withdraw():
    from approvals.signals import request_decided

    requester = _user("wr@x.com")
    Employee.objects.create(user=requester, employee_code="WR1")
    seen = []
    request_decided.connect(
        lambda sender, request, actor, status, **kw: seen.append(status), weak=False
    )

    req = service.create_request(requester, "leave", {})
    service.withdraw(req, requester)
    assert seen == [RequestStatus.WITHDRAWN]
