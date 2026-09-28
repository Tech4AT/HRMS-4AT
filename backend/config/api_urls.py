"""Mounted at /api/v1/.

Core apps are included explicitly. Every other installed app is mounted
automatically if it has an `api_urls.py` exposing `urlpatterns`, so a plug-in
module only has to be added to INSTALLED_APPS and ship `rbac.py` (its
permissions) and `api_urls.py` (its routes). No core file needs editing.
"""

from importlib.util import find_spec

from django.conf import settings
from django.urls import include, path

CORE_APPS = {"employees", "accounts"}

urlpatterns = [
    path("", include("employees.urls")),
    path("", include("accounts.urls")),
    path("exits/", include("employees.urls_exits")),
]

for _app in settings.INSTALLED_APPS:
    if _app not in CORE_APPS and find_spec(f"{_app}.api_urls") is not None:
        urlpatterns.append(path("", include(f"{_app}.api_urls")))
