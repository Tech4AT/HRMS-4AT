"""Shared asset-import logic used by both the `import_assets` management
command and the HTTP upload action (AssetViewSet.import). Given rows already
read from the HR export (CSV or xlsx), upsert Asset rows idempotently by
asset_tag.

The export is messy: row 1 ("CONSULT-4AT") and row 2 ("LAPTOP INFORMATION")
are junk, row 3 is the header, data starts at row 4, and only the first 11
columns are real. We skip the first 3 rows, but tolerate a file that starts
straight at the header by dropping a leading row whose tag cell reads like a
header. ponytail: fixed 11-column layout matching the current tracker; if the
export columns are ever reordered this needs a header-driven mapping.
"""

from datetime import datetime

from assets.models import Asset
from employees.models import Employee

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


def _cell(row, i):
    v = row[i] if i < len(row) else ""
    return ("" if v is None else str(v)).strip()


def import_asset_rows(rows):
    """Upsert assets from raw spreadsheet rows (list of list of cells).

    Returns a summary dict: created, updated, unassigned, unmatched, total,
    assigned. Raises ValueError if the file is too short to hold any data.
    """
    if len(rows) < 4:
        raise ValueError(f"File too short ({len(rows)} rows): need the 3 header rows + data.")
    data = [r for r in rows[3:] if r and any(_cell(r, i) for i in range(11))]
    # Tolerate an already-trimmed file whose first kept row is the header.
    if data and _cell(data[0], 2).lower() in ("asset tag", "asset_tag", "tag"):
        data = data[1:]

    by_name = {
        e.user.get_full_name().strip().lower(): e
        for e in Employee.objects.select_related("user").all()
    }

    created = updated = unassigned = unmatched = 0
    for r in data:
        cells = [_cell(r, i) for i in range(11)]
        (_, emp_name, tag, brand, serial, processor, ram, allotted, bag, recovered, prev_used) = cells
        if not tag:
            continue
        emp = _match_employee(emp_name, by_name)
        if emp_name.lower() not in UNASSIGNED and emp is None:
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
                "has_bag": bag.lower() in ("yes", "y", "true", "1"),
                "previously_used": prev_used,
                "assigned_to": emp,
            },
        )
        created += was_created
        updated += not was_created

    return {
        "created": created,
        "updated": updated,
        "unassigned": unassigned,
        "unmatched": unmatched,
        "total": Asset.objects.count(),
        "assigned": Asset.objects.filter(assigned_to__isnull=False).count(),
    }


def rows_from_upload(filename, raw_bytes):
    """Parse an uploaded asset file into rows. .xlsx → openpyxl; else CSV."""
    if filename.lower().endswith((".xlsx", ".xlsm")):
        import io

        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        ws = wb.active
        if ws is None:
            return []
        return [list(row) for row in ws.iter_rows(values_only=True)]

    import csv
    import io

    text = raw_bytes.decode("utf-8-sig", errors="replace")
    return list(csv.reader(io.StringIO(text)))
