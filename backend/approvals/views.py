"""Approval request endpoints. Anyone signed in can raise a request and list the
ones they raised or must approve; holders of approvals.manage see all and get the
reassign / force-resolve escape hatches. The lifecycle rules live in service.py —
these handlers just translate HTTP to those calls (and its raises to 4xx)."""

from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.api import FrontendEnvelopeMixin
from core.scope import user_has_permission

from . import service
from .models import Request
from .serializers import RequestSerializer

MANAGE = "approvals.manage"


class RequestViewSet(FrontendEnvelopeMixin, viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = RequestSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        user = self.request.user
        base = Request.objects.select_related("requester", "approver")
        if user_has_permission(user, MANAGE):
            return base
        return base.filter(Q(requester=user) | Q(approver=user))

    def create(self, request, *args, **kwargs):
        req = service.create_request(
            request.user,
            request.data.get("request_type", ""),
            request.data.get("payload") or {},
        )
        return Response({"success": True, "data": RequestSerializer(req).data}, status=201)

    def _get_object_any(self, pk):
        # Act-on lookups aren't limited to the list queryset — the service layer
        # decides who may act; a 404 here would leak nothing but also help no one.
        return Request.objects.filter(pk=pk).first()

    def _act(self, pk, fn):
        req = self._get_object_any(pk)
        if req is None:
            return Response({"success": False, "error": {"message": "Not found."}}, status=404)
        result = fn(req)
        return Response({"success": True, "data": RequestSerializer(result).data})

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._act(
            pk, lambda r: service.decide(r, request.user, "approved", request.data.get("note", ""))
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._act(
            pk, lambda r: service.decide(r, request.user, "rejected", request.data.get("note", ""))
        )

    @action(detail=True, methods=["post"])
    def withdraw(self, request, pk=None):
        return self._act(pk, lambda r: service.withdraw(r, request.user))

    @action(detail=True, methods=["post"])
    def reassign(self, request, pk=None):
        self._require_manage()
        from django.contrib.auth import get_user_model

        new_approver = get_user_model().objects.filter(pk=request.data.get("approver")).first()
        return self._act(pk, lambda r: service.reassign(r, new_approver))

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        self._require_manage()
        return self._act(
            pk,
            lambda r: service.force_resolve(
                r,
                request.user,
                request.data.get("status", "approved"),
                request.data.get("note", ""),
            ),
        )

    def _require_manage(self):
        from rest_framework.exceptions import PermissionDenied

        if not user_has_permission(self.request.user, MANAGE):
            raise PermissionDenied("You need approvals.manage to do this.")
