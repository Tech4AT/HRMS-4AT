from .base import *  # noqa: F401,F403

DEBUG = True
# "testserver" is Django's own test-client host, not a real network name —
# harmless to allow here so manage.py shell / ad hoc scripts using
# django.test.Client work without a separate settings module. Any extra hosts
# from DJANGO_ALLOWED_HOSTS are appended (e.g. the "backend" service name when
# the frontend proxies to it over the docker-compose network).
import os as _os  # noqa: E402

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver"] + [
    h.strip() for h in _os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()
]

# Local dev only: cookies over plain http don't work with Secure=True.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Postgres (base.py, from POSTGRES_* in backend/.env) when configured; SQLite
# otherwise so the backend still runs with no database server. Some core
# queries (team scope, row locking) need Postgres.
if not _os.environ.get("POSTGRES_HOST") and not env("POSTGRES_HOST", default=""):  # noqa: F405
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": "db.sqlite3",
        }
    }

# Reference plug-in module (see example_leave/). Never installed in production.
INSTALLED_APPS = [*INSTALLED_APPS, "example_leave"]  # noqa: F405

