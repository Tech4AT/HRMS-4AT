from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def healthz(request):
    """Unauthenticated health check for ECS/ALB. Optionally pings the DB."""
    try:
        from django.db import connection
        connection.ensure_connection()
        db_ok = True
    except Exception:
        db_ok = False
    status = 200 if db_ok else 503
    return JsonResponse({"status": "ok" if db_ok else "degraded", "db": db_ok}, status=status)


urlpatterns = [
    path("healthz", healthz),
    path("admin/", admin.site.urls),
    path("api/v1/", include("config.api_urls")),
]
