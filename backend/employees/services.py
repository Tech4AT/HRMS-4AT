"""Employee write operations that touch more than one table."""

from django.db import transaction


@transaction.atomic
def update_legal_name(employee, first_name: str, last_name: str):
    """Change a person's legal name.

    The name lives on the linked User (what the app reads everywhere) and is
    mirrored on the Employee row for the onboarding module. Employee.save()
    only fills an empty mirror and never overwrites one, so a rename has to set
    both sides explicitly or the two drift apart (the mirror feeds
    /employees/lookup)."""
    user = employee.user
    user.first_name = first_name
    user.last_name = last_name
    user.save(update_fields=["first_name", "last_name"])
    employee.first_name = first_name
    employee.last_name = last_name
    employee.save(update_fields=["first_name", "last_name", "updated_at"])
    return employee
