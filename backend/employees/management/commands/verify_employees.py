"""Live verification of the employee and organisation module.

    python manage.py verify_employees [--html] [--open]

Runs against the real API and database, on a fictional company built for the run and
rolled back afterwards, so it is safe on the dev database. It checks: directory reach at
all seven levels (the plug-in conformance kit), managing the organisation structure,
the employee lifecycle (joining, leaving, returning), personal details and who may see
them, and self-service. It also prints a data-quality summary of the employees already
in the database (counts only, no names).
"""

from datetime import date

from audit.models import AuditLog
from core.conformance import ScopedEndpoint, run_conformance
from core.fictional_org import EMAIL_DOMAIN, ORG_CHART, PASSWORD, FictionalOrg
from core.verification import VerificationCommand
from employees.models import Employee

API = "/api/v1"

ENDPOINT = ScopedEndpoint(
    label="Employee directory",
    list_url=f"{API}/employees/",
    detail_url=lambda pk: f"{API}/employees/{pk}/",
    read_permission="employees.read",
    create_record=lambda employee: employee.pk,  # the record is the person themselves
    owner_of=lambda row: row["id"],
    write_permission="employees.write",
)

PERSONAL_KEYS = {"phone", "dob", "personal_email", "gender", "exit_reason"}


class Command(VerificationCommand):
    title = "Employee and organisation module: live verification"
    help = "Run live checks of the employee directory and organisation structure (rolled back)."

    def verify(self, v):
        self.org = FictionalOrg.build()
        self.people = self.org.people
        v.section("Setup")
        v.block(ORG_CHART)

        self._existing_data(v)
        self._structure(v)
        self._lifecycle(v)
        self._personal_details(v)
        self._self_service(v)
        # Last on purpose: the conformance kit swaps each person's role for a
        # one-permission role to test every reach level, which would otherwise
        # change who Hana, Maya and the others are for the checks above.
        run_conformance(v, self.org, ENDPOINT)

    def login(self, v, key):
        return v.login(key, self.org.email(key), PASSWORD)

    # -- the data already in the database ------------------------------------------

    def _existing_data(self, v):
        v.section("The data already in the database (counts only)")
        real = Employee.objects.exclude(employee_code__startswith="VFY-")
        total = real.count()
        v.note(f"{total} employees in the directory (not counting this run's fictional people)")
        for label, field in [
            ("with a manager", "manager"),
            ("with a department", "department"),
            ("with a job title", "designation"),
            ("with a location", "location"),
            ("with a legal entity", "legal_entity"),
            ("with a business unit", "business_unit"),
            ("with a cost centre", "cost_center"),
            ("with a joining date", "date_of_joining"),
        ]:
            filled = total - real.filter(**{f"{field}__isnull": True}).count()
            v.note(f"  {filled:>4} of {total} {label}")
        v.note(
            f"  {real.filter(status='exited').count()} have left, "
            f"{real.filter(status='on_leave').count()} are on leave"
        )

    # -- organisation structure ---------------------------------------------------------

    def _structure(self, v):
        v.section("Managing the organisation structure")
        hana = self.login(v, "hana")

        for key in ("eve", "maya", "finn"):
            who = self.org.first_name(key)
            v.expect_status(
                f"{who} ({','.join(self.people[key].user.roles.values_list('name', flat=True))}) cannot manage the structure",
                self.login(v, key).get(f"{API}/org/departments/"),
                403,
            )

        kinds = {
            "job-titles": ("job title", "VFY Principal Engineer"),
            "locations": ("location", "VFY Pune"),
            "legal-entities": ("legal entity", "VFY Holdings Ltd"),
            "business-units": ("business unit", "VFY Cloud"),
            "cost-centers": ("cost centre", "VFY Platform CC"),
        }
        for kind, (label, name) in kinds.items():
            v.expect_status(
                f"HR Admin creates a {label}",
                hana.post(f"{API}/org/{kind}/", {"name": name}),
                201,
            )
        v.expect_status(
            "a duplicate name is refused",
            hana.post(f"{API}/org/job-titles/", {"name": kinds["job-titles"][1]}),
            400,
        )
        coded = hana.post(f"{API}/org/cost-centers/", {"name": "VFY Finance CC", "code": "CC-9001"})
        found = hana.get(f"{API}/org/cost-centers/?search=9001").json()["results"]
        v.check(
            "a cost centre keeps its finance code and can be found by it",
            coded.status_code == 201 and [c["name"] for c in found] == ["VFY Finance CC"],
        )

        v.note("--- departments form a tree")
        top = hana.post(f"{API}/org/departments/", {"name": "VFY Platform"}).json()["id"]
        sub_response = hana.post(
            f"{API}/org/departments/", {"name": "VFY Platform Core", "parent": top}
        )
        sub = sub_response.json()["id"]
        v.check(
            "a sub-department reports its parent",
            sub_response.json()["parentName"] == "VFY Platform",
        )
        v.expect_status(
            "a department cannot be moved under its own sub-department",
            hana.patch(f"{API}/org/departments/{top}/", {"parent": sub}),
            400,
        )
        v.expect_status(
            "a department with sub-departments cannot be deleted (409)",
            hana.delete(f"{API}/org/departments/{top}/"),
            409,
        )

        v.note("--- units people belong to cannot be deleted")
        eli_url = f"{API}/employees/{self.people['eli'].pk}/"
        v.expect_status(
            "HR assigns Eli to the sub-department", hana.patch(eli_url, {"department_id": sub}), 200
        )
        blocked = hana.delete(f"{API}/org/departments/{sub}/")
        v.expect_status(
            "the sub-department, now holding a person, cannot be deleted (409)", blocked, 409
        )
        v.check(
            "the message says how many people and suggests deactivating",
            "1 person" in blocked.json()["error"]["message"]
            and "deactivate" in blocked.json()["error"]["message"],
        )
        hana.patch(eli_url, {"department_id": top})
        v.expect_status(
            "once emptied, the sub-department can be deleted",
            hana.delete(f"{API}/org/departments/{sub}/"),
            204,
        )

        deactivated = hana.patch(f"{API}/org/departments/{top}/", {"isActive": False})
        v.expect_status("HR deactivates the department instead of deleting it", deactivated, 200)
        picker = [d["name"] for d in hana.get(f"{API}/departments/").json()["data"]]
        admin = [
            d
            for d in hana.get(f"{API}/org/departments/?pageSize=100").json()["results"]
            if d["name"] == "VFY Platform"
        ]
        v.check(
            "it leaves the pickers but stays visible to administrators, with its people",
            "VFY Platform" not in picker
            and admin
            and admin[0]["isActive"] is False
            and admin[0]["employeeCount"] == 1,
        )

    # -- lifecycle ------------------------------------------------------------------------

    def _lifecycle(self, v):
        v.section("Employee lifecycle: joining, leaving and returning")
        hana = self.login(v, "hana")

        created = hana.post(
            f"{API}/employees/",
            {
                "first_name": "Nia",
                "last_name": "North",
                "work_email": f"vfy.nia@{EMAIL_DOMAIN}",
                "employee_code": "VFY-NIA",
                "employment_type": "contract",
                "date_of_joining": "2024-03-04",
            },
        )
        v.expect_status(
            "HR adds a new joiner with a joining date and employment type", created, 201
        )
        row = created.json()["data"]
        v.check(
            "the record carries the dates and type",
            row["date_of_joining"] == "2024-03-04" and row["employment_type"] == "contract",
        )
        nia_url = f"{API}/employees/{row['id']}/"
        v.expect_status(
            "an exit date before the joining date is refused",
            hana.patch(nia_url, {"status": "exited", "date_of_exit": "2024-01-01"}),
            400,
        )
        v.expect_status(
            "an exit date on someone who has not left is refused",
            hana.patch(nia_url, {"date_of_exit": "2025-01-01"}),
            400,
        )

        v.note("--- Eve leaves")
        eve = self.login(v, "eve")
        eve_url = f"{API}/employees/{self.people['eve'].pk}/"
        v.expect_status("Eve is signed in", eve.get(f"{API}/ess/profile"), 200)
        left = hana.patch(eve_url, {"status": "exited", "exit_reason": "Relocated"})
        v.expect_status("HR marks Eve as having left", left, 200)
        v.expect(
            "today is recorded as her exit date",
            left.json()["data"]["date_of_exit"],
            date.today().isoformat(),
        )
        v.expect_status(
            "her existing session stops working at once", eve.get(f"{API}/ess/profile"), 401
        )
        v.expect_status(
            "she cannot sign in again",
            v.session("eve").login(self.org.email("eve"), PASSWORD),
            401,
        )
        v.check(
            "the reason is kept with HR-only details, not in the directory",
            "exit_reason" not in left.json()["data"]
            and hana.get(f"{eve_url}personal/").json()["data"]["exit_reason"] == "Relocated",
        )

        back = hana.patch(eve_url, {"status": "active"})
        v.expect_status("HR brings Eve back", back, 200)
        v.check(
            "her exit date and reason are cleared",
            back.json()["data"]["date_of_exit"] is None
            and hana.get(f"{eve_url}personal/").json()["data"]["exit_reason"] == "",
        )
        v.expect_status(
            "she can sign in again", v.session("eve").login(self.org.email("eve"), PASSWORD), 200
        )

        v.note("--- finding gaps in the data")
        gaps = hana.get(f"{API}/employees/?no_manager=1").json()["data"]
        codes = {r["employee_code"] for r in gaps}
        v.check(
            "the directory can list people with no manager (to fix reporting lines)",
            "VFY-HANA" in codes and "VFY-ELI" not in codes,
        )
        leavers = hana.get(f"{API}/employees/?status=exited").json()["data"]
        v.check("and filter by status", all(r["status"] == "exited" for r in leavers))

    # -- personal details -------------------------------------------------------------------

    def _personal_details(self, v):
        v.section("Personal details: kept out of the directory, HR only")
        hana = self.login(v, "hana")
        eli_url = f"{API}/employees/{self.people['eli'].pk}/"

        row = hana.get(eli_url).json()["data"]
        v.check(
            "the ordinary directory record carries no personal details, even for HR",
            not PERSONAL_KEYS & set(row),
        )
        changed = hana.patch(
            f"{eli_url}personal/",
            {
                "phone": "555-0142",
                "dob": "1990-06-15",
                "gender": "male",
                "personal_email": "eli@home.invalid",
            },
        )
        v.expect_status("HR records Eli's personal details", changed, 200)
        v.expect(
            "and reads them back",
            hana.get(f"{eli_url}personal/").json()["data"]["dob"],
            "1990-06-15",
        )
        entry = AuditLog.objects.filter(action="Employee.personal_updated").latest("id")
        v.check(
            "the audit entry lists the fields changed but never their values",
            entry.diff.get("fields") == ["dob", "gender", "personal_email", "phone"]
            and "555-0142" not in str(entry.diff),
        )
        v.expect_status(
            "a future date of birth is refused",
            hana.patch(f"{eli_url}personal/", {"dob": "2999-01-01"}),
            400,
        )
        for key in ("maya", "eve", "finn"):
            v.expect_status(
                f"{self.org.first_name(key)} ({','.join(self.people[key].user.roles.values_list('name', flat=True))}) cannot read them",
                self.login(v, key).get(f"{eli_url}personal/"),
                403,
            )

    # -- self-service ---------------------------------------------------------------------------

    def _self_service(self, v):
        v.section("Self-service: a person's own profile")
        eli = self.login(v, "eli")
        profile = eli.get(f"{API}/ess/profile")
        v.expect_status("Eli opens his own profile", profile, 200)
        data = profile.json()["data"]
        v.check(
            "it is the shape the frontend's profile and organisation pages read",
            data["id"] == str(self.people["eli"].pk)
            and {
                "first_name",
                "work_email",
                "personal_email",
                "dob",
                "gender",
                "department_id",
                "date_of_joining",
                "status",
                "manager_id",
            }
            <= set(data),
        )
        v.check(
            "it holds the details HR recorded", data["dob"] == "1990-06-15" or data["dob"] is None
        )

        saved = eli.put(f"{API}/ess/profile", {"dob": "1991-07-16", "gender": "female"})
        v.expect_status(
            "he updates his date of birth and gender (PUT, as the page does)", saved, 200
        )
        v.expect(
            "the change is kept", eli.get(f"{API}/ess/profile").json()["data"]["dob"], "1991-07-16"
        )

        eli.patch(f"{API}/ess/profile", {"manager_id": self.people["dana"].pk, "status": "exited"})
        v.check(
            "he cannot change his own manager or status this way",
            Employee.objects.get(pk=self.people["eli"].pk).manager_id == self.people["maya"].pk
            and Employee.objects.get(pk=self.people["eli"].pk).status == "active",
        )
        v.expect_status(
            "an anonymous caller is refused", v.session("anon").get(f"{API}/ess/profile"), 401
        )
