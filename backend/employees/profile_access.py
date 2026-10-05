"""Who may see and change what on one employee's 360 profile.

One place decides this, so the profile endpoints stay thin and the frontend can
render straight from the flags it returns instead of guessing from role names.

- The person themselves: ess.profile.read / ess.profile.write (everyone has
  these at SELF tier by default).
- Everyone else: the scoped employees.* codes, resolved for *that* employee.

Job information follows the ordinary directory rule (employees.read). Personal
data (personal email, phone, date of birth, gender, address, emergency
contacts) follows employees.personal.read / .write. A legal-name change follows
employees.write for others, since the name is directory data, not personal data.
"""

from dataclasses import dataclass

from core.scope import resolve_employee_scope, user_has_permission


@dataclass(frozen=True)
class ProfileAccess:
    is_self: bool
    can_view: bool
    can_read_personal: bool
    can_edit_personal: bool
    can_edit_name: bool

    def as_flags(self) -> dict:
        return {
            "is_self": self.is_self,
            "can_read_personal": self.can_read_personal,
            "can_edit_personal": self.can_edit_personal,
            "can_edit_name": self.can_edit_name,
        }


def resolve_profile_access(user, employee) -> ProfileAccess:
    own = getattr(user, "employee", None)
    is_self = own is not None and own.pk == employee.pk

    def in_scope(code: str) -> bool:
        return resolve_employee_scope(user, code).filter(pk=employee.pk).exists()

    def allowed(self_code: str, scoped_code: str) -> bool:
        return (is_self and user_has_permission(user, self_code)) or in_scope(scoped_code)

    return ProfileAccess(
        is_self=is_self,
        can_view=allowed("ess.profile.read", "employees.read"),
        can_read_personal=allowed("ess.profile.read", "employees.personal.read"),
        can_edit_personal=allowed("ess.profile.write", "employees.personal.write"),
        # Legal name is never self-editable; it changes only through HR/admin scope
        # over someone else's record.
        can_edit_name=(not is_self) and in_scope("employees.write"),
    )
