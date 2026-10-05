"""Idempotent import of the laptop inventory from the real HR export CSV.

The CSV is PII and gitignored — read it at RUNTIME from the mounted path
(default /data/docs/asset_laptops.csv), never from a commit. Parsing lives in
assets.importer (shared with the HTTP upload action).
"""

import os

from django.core.management.base import BaseCommand, CommandError

from assets.importer import import_asset_rows, rows_from_upload

DEFAULT_PATH = os.environ.get("ASSETS_CSV", "/data/docs/asset_laptops.csv")


class Command(BaseCommand):
    help = "Import/update laptop assets from the HR export CSV (idempotent by asset_tag)."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=DEFAULT_PATH, help="Path to asset_laptops.csv")

    def handle(self, *args, **opts):
        path = opts["path"]
        if not os.path.exists(path):
            raise CommandError(f"CSV not found: {path}")
        with open(path, "rb") as f:
            rows = rows_from_upload(path, f.read())
        try:
            r = import_asset_rows(rows)
        except ValueError as e:
            raise CommandError(str(e))
        self.stdout.write(self.style.SUCCESS(
            f"Assets: {r['created']} created, {r['updated']} updated "
            f"({r['total']} total; {r['assigned']} assigned, "
            f"{r['unassigned']} unassigned rows, {r['unmatched']} names matched no employee)."
        ))
