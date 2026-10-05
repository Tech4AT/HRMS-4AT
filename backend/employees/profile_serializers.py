"""Serializers behind the Employee 360 profile (employees/profile_views.py).
snake_case, string ids, like the rest of the employee endpoints."""

import re

from rest_framework import serializers

from employees.models import Employee, EmployeeAbout, EmployeeAddress, EmergencyContact, EmployeeSkill
from employees.serializers import EmployeeSerializer, EssProfileWriteSerializer

# Letters (any script) separated by single spaces, apostrophes, hyphens or dots.
_NAME_RE = re.compile(r"[^\W\d_]+(?:[ '.-]+[^\W\d_]+)*\.?")
_PHONE_RE = re.compile(r"\+?[0-9][0-9 ()-]*")
_POSTAL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]")


def validate_phone_number(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    digits = re.sub(r"\D", "", value)
    if not _PHONE_RE.fullmatch(value) or not 7 <= len(digits) <= 15:
        raise serializers.ValidationError(
            "Enter a valid phone number (7-15 digits; +, spaces, brackets and hyphens are allowed)."
        )
    return value


class LegalNameSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=60)
    last_name = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")

    def _clean(self, value: str) -> str:
        value = re.sub(r"\s+", " ", value).strip()
        if value and not _NAME_RE.fullmatch(value):
            raise serializers.ValidationError(
                "Use letters only; spaces, apostrophes, hyphens and dots are allowed between them."
            )
        return value

    def validate_first_name(self, value):
        value = self._clean(value)
        if not value:
            raise serializers.ValidationError("First name is required.")
        return value

    def validate_last_name(self, value):
        return self._clean(value)


class ProfilePersonalSerializer(serializers.ModelSerializer):
    """The personal fields shown on the profile (read shape)."""

    class Meta:
        model = Employee
        fields = ["personal_email", "phone", "dob", "gender"]


class ProfilePersonalWriteSerializer(EssProfileWriteSerializer):
    """What may be changed through the profile. Same field allow-list as the
    self-service profile (personal email, phone, date of birth, gender), plus a
    phone format check the older endpoints do not have."""

    def validate_phone(self, value):
        return validate_phone_number(value)


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeAddress
        fields = [
            "current_line1",
            "current_line2",
            "current_city",
            "current_state",
            "current_postal_code",
            "current_country",
            "permanent_same_as_current",
            "permanent_line1",
            "permanent_line2",
            "permanent_city",
            "permanent_state",
            "permanent_postal_code",
            "permanent_country",
        ]

    def _postal(self, value):
        value = (value or "").strip()
        if value and not _POSTAL_RE.fullmatch(value):
            raise serializers.ValidationError("Enter a valid postal code.")
        return value

    def validate_current_postal_code(self, value):
        return self._postal(value)

    def validate_permanent_postal_code(self, value):
        return self._postal(value)

    def validate(self, attrs):
        same = attrs.get("permanent_same_as_current")
        if same is None and self.instance is not None:
            same = self.instance.permanent_same_as_current
        if same is None:
            same = True
        if same:
            # The permanent address is "same as current", so it holds nothing of
            # its own — never let a stale copy linger behind the flag.
            for field in self.Meta.fields:
                if field.startswith("permanent_") and field != "permanent_same_as_current":
                    attrs[field] = ""
        return attrs


class EmergencyContactSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    name = serializers.CharField(max_length=150)
    relationship = serializers.CharField(max_length=60)
    phone = serializers.CharField(max_length=30)

    class Meta:
        model = EmergencyContact
        fields = ["id", "name", "relationship", "phone"]

    def get_id(self, obj):
        return str(obj.pk)

    def validate_name(self, value):
        value = re.sub(r"\s+", " ", value).strip()
        if not value:
            raise serializers.ValidationError("Name is required.")
        return value

    def validate_relationship(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Relationship is required.")
        return value

    def validate_phone(self, value):
        value = validate_phone_number(value)
        if not value:
            raise serializers.ValidationError("Phone number is required.")
        return value


ABOUT_MAX_LENGTH = 1000
MAX_SKILLS = 20
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class AboutSerializer(serializers.ModelSerializer):
    """The About card's three answers. Blank clears one."""

    class Meta:
        model = EmployeeAbout
        fields = ["about", "love_about_job", "interests"]
        extra_kwargs = {
            f: {"required": False, "allow_blank": True, "max_length": ABOUT_MAX_LENGTH}
            for f in fields
        }

    def _clean(self, value):
        value = (value or "").strip()
        if _CONTROL_RE.search(value):
            raise serializers.ValidationError("This contains characters that are not allowed.")
        return value

    def validate_about(self, value):
        return self._clean(value)

    def validate_love_about_job(self, value):
        return self._clean(value)

    def validate_interests(self, value):
        return self._clean(value)


class SkillSerializer(serializers.ModelSerializer):
    id = serializers.SerializerMethodField()
    name = serializers.CharField(max_length=60)

    class Meta:
        model = EmployeeSkill
        fields = ["id", "name"]

    def get_id(self, obj):
        return str(obj.pk)

    def validate_name(self, value):
        value = re.sub(r"\s+", " ", value).strip()
        if not value:
            raise serializers.ValidationError("Skill name is required.")
        if _CONTROL_RE.search(value):
            raise serializers.ValidationError("This contains characters that are not allowed.")
        employee = self.context["employee"]
        if employee.skills.filter(name__iexact=value).exists():
            raise serializers.ValidationError("You have already added this skill.")
        return value


def about_payload(employee) -> dict:
    about = EmployeeAbout.objects.filter(employee=employee).first()
    return AboutSerializer(about if about else EmployeeAbout(employee=employee)).data


def _full_name(employee) -> str:
    user = employee.user
    return f"{user.first_name} {user.last_name}".strip()


def job_payload(employee) -> dict:
    """Job information: the ordinary directory row plus the resolved names, so
    the page needs no separate lookup calls (which a narrow role could not make)."""
    data = dict(EmployeeSerializer(employee).data)
    manager = employee.manager
    data.update(
        {
            "designation_name": employee.designation.name if employee.designation_id else None,
            "department_name": employee.department.name if employee.department_id else None,
            "location_name": employee.location.name if employee.location_id else None,
            "legal_entity_name": employee.legal_entity.name if employee.legal_entity_id else None,
            "business_unit_name": employee.business_unit.name if employee.business_unit_id else None,
            "cost_center_name": employee.cost_center.name if employee.cost_center_id else None,
            "manager": (
                {"id": str(manager.pk), "name": _full_name(manager) or manager.employee_code}
                if manager
                else None
            ),
        }
    )
    return data


def address_payload(employee) -> dict:
    address = EmployeeAddress.objects.filter(employee=employee).first()
    return AddressSerializer(address if address else EmployeeAddress(employee=employee)).data
