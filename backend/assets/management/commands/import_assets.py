"""Idempotent import of the laptop inventory from the real HR export CSV.

The CSV is messy: row 1 ("CONSULT-4AT") and row 2 ("LAPTOP INFORMATION") are
junk, row 3 is the real header, data starts at row 4, and only the first 11
columns are real (trailing columns hold stray notes). The file is PII and
gitignored — read it at RUNTIME from the mounted path (default
/data/docs/asset_laptops.csv, like roster.xlsx), never from a commit.
"""

import csv
import os
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from assets.models import Asset
from employees.models import Employee

DEFAULT_PATH = os.environ.get("ASSETS_CSV", "/data/docs/asset_laptops.csv")

UNASSIGNED = {"", "not assigned", "na", "n/a", "none", "-"}


def _parse_date(value):
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%m/%d/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _match_employee(name, by_name):
    """Best-effort match of an EMP NAME cell to a real Employee (by the
    user's full name, lowercased). Returns None for unassigned/unknown."""
    key = (name or "").strip().lower()
    if key in UNASSIGNED:
        return None
    if key in by_name:
        return by_name[key]
    tokens = set(key.split())
    if tokens:
        for full, emp in by_name.items():
            parts = set(full.split())
            if parts and (parts <= tokens or tokens <= parts):
                return emp
    return None


class Command(BaseCommand):
    help = "Import/update laptop assets from the HR export CSV (idempotent by asset_tag)."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=DEFAULT_PATH, help="Path to asset_laptops.csv")

    def handle(self, *args, **opts):
        path = opts["path"]
        if not os.path.exists(path):
            raise CommandError(f"CSV not found: {path}")
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = list(csv.reader(f))
        if len(rows) < 4:
            raise CommandError(f"CSV too short ({len(rows)} rows): {path}")
        data = [r for r in rows[3:] if r and any((c or "").strip() for c in r[:11])]

        by_name = {e.user.get_full_name().strip().lower(): e for e in Employee.objects.select_related("user").all()}

        created = updated = unassigned = unmatched = 0
        for r in data:
            cells = [(r[i] if i < len(r) else "").strip() for i in range(11)]
            (_, emp_name, tag, brand, serial, processor, ram, allotted, bag, recovered, prev_used) = cells
            if not tag:
                continue
            emp = _match_employee(emp_name, by_name)
            if (emp_name or "").strip().lower() not in UNASSIGNED and emp is None:
                unmatched += 1
            if emp is None:
                unassigned += 1
            _, was_created = Asset.objects.update_or_create(
                asset_tag=tag,
                defaults={
                    "brand": brand,
                    "serial": serial,
                    "processor": processor,
                    "ram": ram,
                    "date_of_allotment": _parse_date(allotted),
                    "date_of_recover": _parse_date(recovered),
                    "has_bag": bag.strip().lower() in ("yes", "y", "true", "1"),
                    "previously_used": prev_used,
                    "assigned_to": emp,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"Assets: {created} created, {updated} updated "
            f"({Asset.objects.count()} total; {Asset.objects.filter(assigned_to__isnull=False).count()} assigned, "
            f"{unassigned} unassigned rows, {unmatched} names matched no employee)."
        ))
