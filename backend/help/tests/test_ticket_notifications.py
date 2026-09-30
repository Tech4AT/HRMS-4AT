"""Raising, editing and reopening a ticket tells the help desk."""

import pytest
from rest_framework.test import APIClient

from accounts.factories import UserFactory
from accounts.models import Role
from employees.factories import EmployeeFactory
from notifications.models import Notification

pytestmark = pytest.mark.django_db

TICKETS = "/api/v1/help/tickets"


def _as(role_name):
    user = UserFactory(role=Role.objects.get(name=role_name))
    employee = EmployeeFactory(user=user)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user, employee


def test_raising_a_ticket_succeeds_and_notifies_help_manage_holders():
    hr_user = UserFactory(role=Role.objects.get(name="HR Admin"))
    EmployeeFactory(user=hr_user)
    client, _, _ = _as("Employee")

    response = client.post(
        TICKETS,
        {"subject": "Laptop", "description": "It will not boot", "category": "IT & Access", "priority": "High"},
        format="json",
    )

    assert response.status_code == 201, response.content
    assert Notification.objects.filter(user=hr_user, title__startswith="New ticket").exists()
