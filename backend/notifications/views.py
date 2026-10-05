"""Self-scoped notification endpoints — every caller sees and mutates only their
own notifications, so the guard is IsAuthenticated + a queryset filtered to
request.user (no RBAC employee-scope: a notification is owned by a user, not
keyed to an employee). Responses use the {success, data} envelope the frontend
notifications client reads; the project's camelCase renderer converts field
names."""

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationSerializer
from .service import broadcast_to


def _mine(request):
    return Notification.objects.filter(user=request.user)


def _resolve_recipients(request, target: dict):
    """Turn an announcement target into the set of users to notify. `target` is
    {"type": everyone|me|admins|role|department|users, ...}. Unknown → everyone."""
    # NB: the project's CamelCase parser has already converted the incoming
    # camelCase keys to snake_case by the time we read them here.
    users = get_user_model().objects.filter(is_active=True)
    kind = (target or {}).get("type", "everyone")
    if kind == "me":
        return users.filter(pk=request.user.pk)
    if kind == "admins":
        return users.filter(is_superuser=True)
    if kind == "role":
        return users.filter(roles__id=target.get("role_id"))
    if kind == "department":
        return users.filter(employee__department_id=target.get("department_id"))
    if kind == "users":
        return users.filter(pk__in=target.get("user_ids") or [])
    return users


class AnnounceView(APIView):
    """Send a broadcast announcement — superadmin only. Every other notification
    endpoint is self-scoped and open to any signed-in user; *sending* is the one
    privileged action, gated on is_superuser. The `target` picks the audience."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_superuser:
            return Response(
                {
                    "success": False,
                    "error": {"message": "Only a superadmin can send announcements."},
                },
                status=403,
            )
        title = (request.data.get("title") or "").strip()
        body = request.data.get("body") or ""
        if not title:
            return Response(
                {"success": False, "error": {"message": "A title is required."}}, status=400
            )
        recipients = _resolve_recipients(request, request.data.get("target") or {})
        count = broadcast_to(recipients, title, body)
        return Response({"success": True, "data": {"count": count}}, status=201)


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            limit = min(max(int(request.query_params.get("limit", 20)), 1), 100)
        except (TypeError, ValueError):
            limit = 20
        queryset = _mine(request)
        unread = queryset.filter(read_at__isnull=True).count()
        data = NotificationSerializer(queryset[:limit], many=True).data
        return Response({"success": True, "data": {"notifications": data, "unreadCount": unread}})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        notification = _mine(request).filter(pk=pk).first()
        if notification is None:
            return Response(
                {"success": False, "error": {"message": "Notification not found."}}, status=404
            )
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(
            {"success": True, "data": {"notification": NotificationSerializer(notification).data}}
        )


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        marked = _mine(request).filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"success": True, "data": {"markedCount": marked}})
