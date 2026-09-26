"""A small fictional company used by every verification command and by the
plug-in conformance kit, so every module is exercised against the same known
organisation and the same independently-stated expectations.

    Dana Diaz (Manager)  Engineering / Austin / Entity A
    +-- Maya Moss (Manager)  Engineering / Austin / Entity A
    |   +-- Eli Egan (Employee)  Engineering / Hyderabad / Entity A
    |   +-- Eve Ames (Employee)  Engineering / Austin / Entity A
    Omar Ortiz (Manager)  Sales / Austin / Entity B
    +-- Sam Shah (Employee)  Sales / Hyderabad / Entity B
    Hana Hart (HR Admin)  People / Austin / Entity A
    Finn Ford (Finance)  Finance / Austin / Entity A

Everything uses the reserved `.invalid` email domain and a `VFY` prefix, is
created inside a rolled-back transaction by the verification harness, and never
touches real employee data.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password

from accounts.models import Permission, Role, RolePermission
from core.enums import ScopeTier
from employees.models import Department, Employee, LegalEntity, Location

User = get_user_model()

PASSWORD = "Verify-Pass-123!"
EMAIL_DOMAIN = "verify.invalid"

# key, first, last, starter role, department, location, legal entity, manager key
PEOPLE = [
    ("hana", "Hana", "Hart", "HR Admin", "People", "Austin", "A", None),
    ("finn", "Finn", "Ford", "Finance", "Finance", "Austin", "A", None),
    ("dana", "Dana", "Diaz", "Manager", "Engineering", "Austin", "A", None),
    ("maya", "Maya", "Moss", "Manager", "Engineering", "Austin", "A", "dana"),
    ("eli", "Eli", "Egan", "Employee", "Engineering", "Hyderabad", "A", "maya"),
    ("eve", "Eve", "Ames", "Employee", "Engineering", "Austin", "A", "maya"),
    ("omar", "Omar", "Ortiz", "Manager", "Sales", "Austin", "B", None),
    ("sam", "Sam", "Shah", "Employee", "Sales", "Hyderabad", "B", "omar"),
]

ORG_CHART = """\
   Fictional company used for this run
   ------------------------------------------------------------------
   Dana Diaz  (Manager)   Engineering / Austin     / Entity A
   +-- Maya Moss  (Manager)   Engineering / Austin     / Entity A
   |   +-- Eli Egan  (Employee)   Engineering / Hyderabad  / Entity A
   |   +-- Eve Ames  (Employee)   Engineering / Austin     / Entity A
   Omar Ortiz (Manager)   Sales / Austin            / Entity B
   +-- Sam Shah  (Employee)   Sales / Hyderabad       / Entity B
   Hana Hart  (HR Admin)  People / Austin           / Entity A
   Finn Ford  (Finance)   Finance / Austin          / Entity A
   ------------------------------------------------------------------"""

EVERYONE = frozenset(key for key, *_ in PEOPLE)

# For each scope tier: which person to test as, and exactly whom that tier must
# cover. Stated by hand from the chart above, NOT computed by the resolver, so a
# resolver bug cannot make its own expectation come true.
TIER_EXPECTATIONS = {
    ScopeTier.SELF: ("eli", {"eli"}),
    ScopeTier.MANAGER: ("maya", {"maya", "eli", "eve"}),
    ScopeTier.TEAM: ("dana", {"dana", "maya", "eli", "eve"}),
    ScopeTier.DEPARTMENT: ("sam", {"sam", "omar"}),
    ScopeTier.LOCATION: ("eli", {"eli", "sam"}),
    ScopeTier.LEGAL_ENTITY: ("maya", {"dana", "maya", "eli", "eve", "hana", "finn"}),
    ScopeTier.ALL: ("hana", set(EVERYONE)),
}


class FictionalOrg:
    def __init__(self, people, hashed_password):
        self.people = people  # key -> Employee
        self.hashed_password = hashed_password
        self.by_id = {str(e.pk): key for key, e in people.items()}
        self._role_counter = 0

    @classmethod
    def build(cls):
        hashed = make_password(PASSWORD)
        entities = {
            "A": LegalEntity.objects.get_or_create(name="VFY Entity A")[0],
            "B": LegalEntity.objects.get_or_create(name="VFY Entity B")[0],
        }
        people = {}
        for key, first, last, role_name, dept, location, entity, _manager in PEOPLE:
            email = f"vfy.{key}@{EMAIL_DOMAIN}"
            user = User.objects.create(
                username=email,
                email=email,
                first_name=first,
                last_name=last,
                password=hashed,
                role=Role.objects.get(name=role_name),
            )
            people[key] = Employee.objects.create(
                user=user,
                employee_code=f"VFY-{key.upper()}",
                department=Department.objects.get_or_create(name=f"VFY {dept}")[0],
                location=Location.objects.get_or_create(name=f"VFY {location}")[0],
                legal_entity=entities[entity],
            )
        for key, *_middle, manager_key in PEOPLE:
            if manager_key:
                people[key].manager = people[manager_key]
                people[key].save(update_fields=["manager"])

        # Not part of the org chart: the account the lockout demo hammers.
        User.objects.create(
            username=f"vfy.lou@{EMAIL_DOMAIN}",
            email=f"vfy.lou@{EMAIL_DOMAIN}",
            password=hashed,
            role=Role.objects.get(name="Employee"),
        )
        return cls(people, hashed)

    def email(self, key):
        return f"vfy.{key}@{EMAIL_DOMAIN}"

    def first_name(self, key):
        return self.people[key].user.first_name

    def names(self, keys):
        return ", ".join(sorted(self.first_name(k) for k in keys)) or "nobody"

    def give_permission(self, key, code, tier):
        """Give one person a brand-new role holding only `code` at `tier`.
        Replaces whatever role they had, so what they can do afterwards is exactly
        this one grant. Returns the Role."""
        self._role_counter += 1
        role = Role.objects.create(
            name=f"VFY {code} {tier} #{self._role_counter}", archetype="employee"
        )
        RolePermission.objects.create(
            role=role, permission=Permission.objects.get(code=code), scope_tier=tier
        )
        user = self.people[key].user
        user.role = role
        user.save(update_fields=["role"])
        return role

    def give_no_permissions(self, key):
        """Give one person a role that holds nothing.

        NOTE: this alone does NOT make them permission-less — anyone WITH an
        employee record still holds the self-service baseline
        (core.scope.baseline_self_permissions). For a truly permission-less
        signed-in caller use add_user_without_permissions()."""
        self._role_counter += 1
        role = Role.objects.create(name=f"VFY empty #{self._role_counter}", archetype="employee")
        user = self.people[key].user
        user.role = role
        user.save(update_fields=["role"])
        return role

    def add_user_without_permissions(self, key="ned"):
        """Create a signed-in user holding an empty role and NO employee record.

        The self-service baseline only applies to users WITH an employee
        record, so this outsider genuinely holds no permissions — the only
        clean way to exercise the signed-in-but-unauthorised (403) invariant.
        Returns the key; sign in with org.email(key) / PASSWORD."""
        self._role_counter += 1
        email = f"vfy.{key}@{EMAIL_DOMAIN}"
        role = Role.objects.create(name=f"VFY empty #{self._role_counter}", archetype="employee")
        User.objects.create(
            username=email,
            email=email,
            first_name="Ned",
            last_name="Noemp",
            password=self.hashed_password,
            role=role,
        )
        return key
