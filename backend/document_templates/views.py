"""Document templates engine endpoints (app envelope {success, data}).

- GET/POST document-templates        (list; create — manage only)
- GET/PATCH/DELETE document-templates/<id> (read all; write — manage only)
- GET document-templates/folders      (list template folders)
- POST document-templates/<id>/generate (manage only — stamps last_used_at
  and returns the rendered template; FLAG: no employee-merge data yet, so
  placeholders are returned as-is)
"""

import re

from django.db.models import Count
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import write_audit
from core.scope import is_hr_admin
from document_templates.models import DocumentTemplate, TemplateFolder
from document_templates.serializers import (
    DocumentTemplateSerializer,
    TemplateFolderSerializer,
)

FORBIDDEN = Response(
    {"success": False, "error": {"code": "FORBIDDEN", "message": "Not permitted"}},
    status=403,
)
NOT_FOUND = Response(
    {"success": False, "error": {"code": "NOT_FOUND", "message": "Template not found"}},
    status=404,
)


def _can_manage(user) -> bool:
    """Templates are org-wide admin objects — HR Admin only (same shape as
    documents' _can_manage_folders: templates.manage is the code, and the
    tier-agnostic permission check would leak admin to every employee)."""
    return is_hr_admin(user)


def _template_dict(t):
    return DocumentTemplateSerializer(t).data


class TemplateListCreateView(APIView):
    """`GET /document-templates` — all templates (optional ?search=,
    ?folder=<id>, ?actionType= filters). `POST` (manage only) creates one."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = DocumentTemplate.objects.select_related("folder", "created_by").all()
        search = (request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(name__icontains=search)
        folder = request.query_params.get("folder")
        if folder:
            qs = qs.filter(folder_id=folder)
        action_type = request.query_params.get("actionType") or request.query_params.get("action_type")
        if action_type:
            qs = qs.filter(action_type=action_type)
        workflow = request.query_params.get("workflowEnabled")
        if workflow in ("true", "false"):
            qs = qs.filter(workflow_enabled=(workflow == "true"))
        data = [_template_dict(t) for t in qs]
        return Response({"success": True, "data": data})

    def post(self, request):
        if not _can_manage(request.user):
            return FORBIDDEN
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response(
                {"success": False, "error": {"code": "VALIDATION_ERROR", "message": "name is required"}},
                status=400,
            )
        serializer = DocumentTemplateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {"success": False, "error": {"code": "VALIDATION_ERROR", "message": serializer.errors}},
                status=400,
            )
        template = serializer.save(created_by=request.user)
        write_audit(request.user, "document_template.create", "document_template", str(template.id), {"name": template.name})
        return Response({"success": True, "data": _template_dict(template)}, status=201)


class TemplateDetailView(APIView):
    """`GET/PATCH/DELETE /document-templates/<id>` (writes manage only)."""

    permission_classes = [IsAuthenticated]

    def _get(self, pk):
        try:
            return DocumentTemplate.objects.select_related("folder", "created_by").get(pk=pk)
        except DocumentTemplate.DoesNotExist:
            return None

    def get(self, request, pk):
        template = self._get(pk)
        if template is None:
            return NOT_FOUND
        return Response({"success": True, "data": _template_dict(template)})

    def patch(self, request, pk):
        if not _can_manage(request.user):
            return FORBIDDEN
        template = self._get(pk)
        if template is None:
            return NOT_FOUND
        serializer = DocumentTemplateSerializer(template, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(
                {"success": False, "error": {"code": "VALIDATION_ERROR", "message": serializer.errors}},
                status=400,
            )
        template = serializer.save()
        write_audit(request.user, "document_template.update", "document_template", str(template.id), {"name": template.name})
        return Response({"success": True, "data": _template_dict(template)})

    def delete(self, request, pk):
        if not _can_manage(request.user):
            return FORBIDDEN
        template = self._get(pk)
        if template is None:
            return NOT_FOUND
        name = template.name
        template.delete()
        write_audit(request.user, "document_template.delete", "document_template", str(pk), {"name": name})
        return Response({"success": True, "data": {"id": pk}}, status=200)


class TemplateFolderListView(APIView):
    """`GET /document-templates/folders` — folders with live template counts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = TemplateFolder.objects.annotate(template_count=Count("templates"))
        data = [TemplateFolderSerializer(f).data for f in qs]
        return Response({"success": True, "data": data})


class TemplateGenerateView(APIView):
    """`POST /document-templates/<id>/generate` (manage only) — stamps
    last_used_at and returns the generated document.

    FLAG: real letter-generation needs employee-merge data (employee name,
    code, dates, …) that this engine does not have yet. Until that lands,
    {{placeholder}} tokens are returned as-is (documented in `placeholders`
    so the caller can merge client-side), or the stored file is echoed when
    the template has no body.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if not _can_manage(request.user):
            return FORBIDDEN
        try:
            template = DocumentTemplate.objects.select_related("folder").get(pk=pk)
        except DocumentTemplate.DoesNotExist:
            return NOT_FOUND
        template.last_used_at = timezone.now()
        template.save(update_fields=["last_used_at", "updated_at"])
        placeholders = sorted(set(re.findall(r"\{\{\s*(\w+)\s*\}\}", template.body or "")))
        payload = {
            "id": template.id,
            "name": template.name,
            "folderName": template.folder.name if template.folder else None,
            "actionType": template.action_type,
            "body": template.body,
            "placeholders": placeholders,
            "fileUrl": template.file.url if template.file else None,
            "generatedAt": template.last_used_at,
        }
        write_audit(request.user, "document_template.generate", "document_template", str(template.id), {"name": template.name})
        return Response({"success": True, "data": payload})
