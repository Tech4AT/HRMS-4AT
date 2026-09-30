"""Employee 360 profile endpoints — one profile, whoever is looking.

`/employees/<id>/profile/…` where <id> is an employee id or the literal `me`
(the caller's own record). Every call resolves the caller's access to that one
employee through employees.profile_access, so the same endpoints serve the
person themselves, HR and a manager, each seeing and changing only what their
permissions allow. The response always carries the `access` flags the UI renders
from. Audit entries list which fields changed, never personal values.
"""

from django.db import transaction
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.service import write_audit
from employees.models import (
    Employee,
    EmployeeAbout,
    EmployeeAddress,
    EmergencyContact,
    EmployeeSkill,
)
from employees.profile_access import resolve_profile_access
from employees.profile_serializers import (
    MAX_SKILLS,
    AboutSerializer,
    AddressSerializer,
    EmergencyContactSerializer,
    LegalNameSerializer,
    ProfilePersonalSerializer,
    ProfilePersonalWriteSerializer,
    SkillSerializer,
    about_payload,
    address_payload,
    job_payload,
)
from employees.services import update_legal_name
from employees.timeline import build_timeline

MAX_EMERGENCY_CONTACTS = 5

_RELATED = (
    "user",
    "manager__user",
    "department",
    "designation",
    "location",
    "legal_entity",
    "business_unit",
    "cost_center",
)


class _ProfileView(APIView):
    renderer_classes = [JSONRenderer]
    parser_classes = [JSONParser]
    permission_classes = [IsAuthenticated]

    def load(self, request, pk):
        """The employee this call is about, and the caller's access to them."""
        if pk == "me":
            employee = getattr(request.user, "employee", None)
            if employee is None:
                raise NotFound("This account has no employee record.")
        else:
            employee = Employee.objects.select_related(*_RELATED).filter(pk=pk).first()
            if employee is None:
                raise NotFound("No such employee.")
        access = resolve_profile_access(request.user, employee)
        if not access.can_view:
            raise PermissionDenied("You do not have access to this profile.")
        return employee, access

    @staticmethod
    def require_read_personal(access):
        if not access.can_read_personal:
            raise PermissionDenied("You may not see this person's personal details.")

    @staticmethod
    def require_edit_personal(access):
        if not access.can_edit_personal:
            raise PermissionDenied("You may not change this person's personal details.")

    @staticmethod
    def ok(data, status=200):
        return Response({"success": True, "data": data}, status=status)


def _profile_payload(employee, access) -> dict:
    job = job_payload(employee)
    data = {
        "id": str(employee.pk),
        "employee_code": employee.employee_code,
        "first_name": employee.user.first_name,
        "last_name": employee.user.last_name,
        "work_email": employee.user.email,
        "status": employee.status,
        "access": access.as_flags(),
        "job": job,
        # Self-expression, not sensitive: visible to anyone who can open the profile.
        "about": about_payload(employee),
        "skills": SkillSerializer(employee.skills.all(), many=True).data,
        "personal": None,
        "address": None,
        "emergency_contacts": None,
    }
    if access.can_read_personal:
        data["personal"] = ProfilePersonalSerializer(employee).data
        data["address"] = address_payload(employee)
        data["emergency_contacts"] = EmergencyContactSerializer(
            employee.emergency_contacts.all(), many=True
        ).data
    return data


class ProfileView(_ProfileView):
    def get(self, request, pk):
        employee, access = self.load(request, pk)
        return self.ok(_profile_payload(employee, access))


class ProfileTimelineView(_ProfileView):
    """Career milestones, newest first. Joining, moves and leaving follow the
    ordinary profile access; the resignation lifecycle is personal and is
    included only for the person and for HR."""

    def get(self, request, pk):
        employee, access = self.load(request, pk)
        events = build_timeline(employee, include_sensitive=access.can_read_personal)
        return self.ok({"events": events})


class ProfileNameView(_ProfileView):
    """PATCH the legal name. Changes the login user and the employee mirror
    together (employees.services.update_legal_name)."""

    def patch(self, request, pk):
        employee, access = self.load(request, pk)
        if not access.can_edit_name:
            raise PermissionDenied("You may not change this person's name.")
        serializer = LegalNameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = {"first_name": employee.user.first_name, "last_name": employee.user.last_name}
        update_legal_name(
            employee,
            serializer.validated_data["first_name"],
            serializer.validated_data.get("last_name", ""),
        )
        write_audit(
            request.user,
            "Employee.name_updated",
            "Employee",
            employee.pk,
            {"before": before, "after": dict(serializer.validated_data)},
        )
        return self.ok(_profile_payload(employee, access))


class ProfilePersonalView(_ProfileView):
    def patch(self, request, pk):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        serializer = ProfilePersonalWriteSerializer(employee, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = sorted(serializer.validated_data)
        serializer.save()
        write_audit(
            request.user,
            "Employee.profile_self_updated" if access.is_self else "Employee.personal_updated",
            "Employee",
            employee.pk,
            {"fields": changed},
        )
        return self.ok(_profile_payload(employee, access))


class ProfileAddressView(_ProfileView):
    def put(self, request, pk):
        return self._save(request, pk)

    def patch(self, request, pk):
        return self._save(request, pk)

    def _save(self, request, pk):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        instance = EmployeeAddress.objects.filter(employee=employee).first()
        serializer = AddressSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = sorted(serializer.validated_data)
        serializer.save(employee=employee)
        write_audit(
            request.user,
            "Employee.address_updated",
            "Employee",
            employee.pk,
            {"fields": changed},
        )
        return self.ok(_profile_payload(employee, access))


class ProfileEmergencyContactsView(_ProfileView):
    def post(self, request, pk):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        serializer = EmergencyContactSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Lock the employee row so two simultaneous adds cannot both pass the cap.
            Employee.objects.select_for_update().get(pk=employee.pk)
            if employee.emergency_contacts.count() >= MAX_EMERGENCY_CONTACTS:
                raise ValidationError(
                    f"You can keep at most {MAX_EMERGENCY_CONTACTS} emergency contacts."
                )
            contact = serializer.save(employee=employee)
        write_audit(
            request.user,
            "Employee.emergency_contact_added",
            "Employee",
            employee.pk,
            {"contact_id": contact.pk},
        )
        return self.ok(_profile_payload(employee, access), status=201)


class ProfileEmergencyContactDetailView(_ProfileView):
    def _contact(self, employee, contact_id):
        contact = EmergencyContact.objects.filter(pk=contact_id, employee=employee).first()
        if contact is None:
            raise NotFound("No such emergency contact.")
        return contact

    def patch(self, request, pk, contact_id):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        contact = self._contact(employee, contact_id)
        serializer = EmergencyContactSerializer(contact, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = sorted(serializer.validated_data)
        serializer.save()
        write_audit(
            request.user,
            "Employee.emergency_contact_updated",
            "Employee",
            employee.pk,
            {"contact_id": contact.pk, "fields": changed},
        )
        return self.ok(_profile_payload(employee, access))

    def delete(self, request, pk, contact_id):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        contact = self._contact(employee, contact_id)
        contact_pk = contact.pk
        contact.delete()
        write_audit(
            request.user,
            "Employee.emergency_contact_removed",
            "Employee",
            employee.pk,
            {"contact_id": contact_pk},
        )
        return self.ok(_profile_payload(employee, access))


class ProfileAboutView(_ProfileView):
    """PATCH the About card's answers. Editable by the person, or by HR."""

    def patch(self, request, pk):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        instance = EmployeeAbout.objects.filter(employee=employee).first()
        serializer = AboutSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = sorted(serializer.validated_data)
        serializer.save(employee=employee)
        write_audit(
            request.user,
            "Employee.about_updated",
            "Employee",
            employee.pk,
            {"fields": changed},
        )
        return self.ok(_profile_payload(employee, access))


class ProfileSkillsView(_ProfileView):
    def post(self, request, pk):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        serializer = SkillSerializer(data=request.data, context={"employee": employee})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Lock the employee row so two simultaneous adds cannot both pass the cap.
            Employee.objects.select_for_update().get(pk=employee.pk)
            if employee.skills.count() >= MAX_SKILLS:
                raise ValidationError(f"You can list at most {MAX_SKILLS} skills.")
            skill = serializer.save(employee=employee)
        write_audit(
            request.user,
            "Employee.skill_added",
            "Employee",
            employee.pk,
            {"skill_id": skill.pk},
        )
        return self.ok(_profile_payload(employee, access), status=201)


class ProfileSkillDetailView(_ProfileView):
    def delete(self, request, pk, skill_id):
        employee, access = self.load(request, pk)
        self.require_edit_personal(access)
        skill = EmployeeSkill.objects.filter(pk=skill_id, employee=employee).first()
        if skill is None:
            raise NotFound("No such skill.")
        skill_pk = skill.pk
        skill.delete()
        write_audit(
            request.user,
            "Employee.skill_removed",
            "Employee",
            employee.pk,
            {"skill_id": skill_pk},
        )
        return self.ok(_profile_payload(employee, access))
