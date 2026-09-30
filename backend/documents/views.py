import mimetypes
import os

from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import write_audit
from core.scope import (
    is_hr_admin,
    user_has_permission,
    visible_employee_ids,
)

from .access import ENTITY_PERMISSIONS, _subject_employee_id, can_access, can_access_entity
from .models import Document, DocumentAccessLog, DocumentAcknowledgement
from .serializers import DocumentSerializer

# Deliberately conservative — these are HR-collected identity/employment
# documents, not a general file share. Extend if a real need shows up, never
# widen just to unblock one upload.
ALLOWED_DOCUMENT_EXTENSIONS = {'.pdf', '.jpg', '.jpeg', '.png'}
MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def _client_ip(request) -> str | None:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


class MyDocumentsView(APIView):
    """`GET /documents/mine` — every file on record for the signed-in
    employee, labelled for display, plus what they may do with each. The
    offer letter appears only as its current *signed* version, never the
    superseded drafts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from employees.models import EducationRecord, EmployeeLetter, IdentityDocument
        from onboarding.models import OFFER_ACCEPTED, OnboardingProfile, OnboardingTask

        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return Response({'success': True, 'data': []})

        docs = list(Document.objects.filter(employee=employee).exclude(entity_type='offer_letter').select_related('uploaded_by'))
        # Audience applies here too: e.g. an hr_only file about this employee
        # is not theirs to see, even though the FK points at them.
        docs = [d for d in docs if can_access(request.user, d)]
        profile = OnboardingProfile.objects.filter(employee=employee).first()
        offer = profile.current_offer_letter if profile else None
        if offer and offer.status == OFFER_ACCEPTED and offer.document_id:
            docs.insert(0, offer.document)

        def ids(entity_type):
            return [int(d.entity_id) for d in docs if d.entity_type == entity_type and str(d.entity_id).isdigit()]

        tasks = {t.id: t for t in OnboardingTask.objects.filter(id__in=ids('onboarding_task'))}
        id_docs = {i.id: i for i in IdentityDocument.objects.filter(id__in=ids('identity_document'))}
        letters = {l.id: l for l in EmployeeLetter.objects.filter(id__in=ids('employee_letter'))}
        education = {r.id: r for r in EducationRecord.objects.filter(id__in=ids('education_record'))}

        items = []
        for d in docs:
            key = int(d.entity_id) if str(d.entity_id).isdigit() else None
            own_upload = d.uploaded_by_id == request.user.id
            can_replace = can_delete = False
            if d.entity_type == 'offer_letter':
                category, title = 'Offer letter', 'Signed Offer Letter'
            elif d.entity_type == 'onboarding_task':
                task = tasks.get(key)
                category, title = 'Onboarding', task.title if task else 'Onboarding document'
                can_replace = own_upload
                # Deleting the last file of a completed step would leave it
                # "done" with nothing behind it — replace instead.
                can_delete = own_upload and not (task and task.status == 'done')
            elif d.entity_type == 'identity_document':
                id_doc = id_docs.get(key)
                category = 'Identity'
                title = id_doc.get_document_type_display() if id_doc else 'Identity document'
                locked = bool(id_doc and id_doc.verification_status == IdentityDocument.VERIFICATION_VERIFIED)
                can_replace = can_delete = own_upload and not locked
            elif d.entity_type == 'education_record':
                record = education.get(key)
                category = 'Education'
                title = ' — '.join(filter(None, [record.degree, record.branch])) if record else 'Certificate'
                locked = bool(record and record.verification_status == EducationRecord.VERIFICATION_VERIFIED)
                can_replace = can_delete = own_upload and not locked
            elif d.entity_type == 'employee_letter':
                letter = letters.get(key)
                category = 'Letters'
                title = (letter.title or letter.get_letter_type_display()) if letter else 'Letter'
            else:
                category, title = 'Other', d.entity_type.replace('_', ' ').capitalize()
            items.append({
                'id': d.id,
                'category': category,
                'title': title,
                'entity_type': d.entity_type,
                'entity_id': d.entity_id,
                'original_filename': d.original_filename,
                'uploaded_at': d.uploaded_at,
                'view_url': f'/api/documents/{d.id}/file',
                'download_url': f'/api/documents/{d.id}/file?mode=download',
                'can_replace': can_replace,
                'can_delete': can_delete,
            })
        return Response({'success': True, 'data': items})


def _to_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


class DocumentListUploadView(APIView):
    """`GET /documents?entityType=&entityId=` and `POST /documents`
    (multipart: file, entityType, entityId, employeeId, expiryDate?). A new
    hire's preboarding checklist can attach any number of documents to the
    same task (e.g. front + back of an ID, several certificates) — nothing
    here limits it to one; the "one document per task" behavior that used
    to exist was purely a frontend UI choice (auto-completing the task on
    first upload), not a backend rule.

    Query/body keys accept camelCase (the frontend convention) and snake_case
    (the API convention) spellings; both mean the same thing.

    Access: an undeclared entityType is denied outright (403 on list, 400 on
    upload). A filtered list that the caller may not see at all is 403, not
    an empty 200 — otherwise anyone could probe which entity ids exist by
    watching the status stay 200. The unfiltered list needs documents.read
    and still returns only rows `can_access` allows."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        entity_type = request.query_params.get('entityType') or request.query_params.get('entity_type')
        entity_id = request.query_params.get('entityId') or request.query_params.get('entity_id')
        if entity_type:
            if entity_type not in ENTITY_PERMISSIONS:
                return Response(
                    {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Unknown document type.'}},
                    status=403,
                )
            qs = Document.objects.filter(entity_type=entity_type)
            if entity_id:
                qs = qs.filter(entity_id=entity_id)
            visible = [d for d in qs if can_access(request.user, d)]
            if not visible and not can_access_entity(request.user, entity_type, entity_id):
                return Response(
                    {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}},
                    status=403,
                )
            return Response({'success': True, 'data': DocumentSerializer(visible, many=True, context={'request': request}).data})
        if not user_has_permission(request.user, 'documents.read') and not is_hr_admin(request.user):
            return Response(
                {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}},
                status=403,
            )
        qs = Document.objects.all()
        visible = [d for d in qs if can_access(request.user, d)]
        return Response({'success': True, 'data': DocumentSerializer(visible, many=True, context={'request': request}).data})

    def post(self, request):
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'file is required'}}, status=400)

        ext = os.path.splitext(file_obj.name)[1].lower()
        if ext not in ALLOWED_DOCUMENT_EXTENSIONS:
            return Response({
                'success': False,
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': f'Unsupported file type "{ext or "unknown"}". Allowed: {", ".join(sorted(ALLOWED_DOCUMENT_EXTENSIONS))}.',
                },
            }, status=400)
        if file_obj.size > MAX_DOCUMENT_SIZE_BYTES:
            return Response({
                'success': False,
                'error': {'code': 'VALIDATION_ERROR', 'message': f'File exceeds the {MAX_DOCUMENT_SIZE_BYTES // (1024 * 1024)} MB limit.'},
            }, status=400)

        # Write-side IDOR guard: nothing previously stopped an authenticated
        # user from uploading (and thus claiming ownership of) a document
        # under any other employee's id. Only HR Admin may upload on behalf
        # of someone else; everyone else can only attach documents to
        # themselves. An omitted employeeId defaults to the requester's own
        # record (self-service upload); callers without an employee record
        # must pass one explicitly and be HR Admin.
        entity_type = request.data.get('entityType') or request.data.get('entity_type') or ''
        entity_id = request.data.get('entityId') or request.data.get('entity_id') or ''
        if entity_type not in ENTITY_PERMISSIONS:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': f'Unknown document type "{entity_type}".'}},
                status=400,
            )
        if not user_has_permission(request.user, 'documents.write') and not is_hr_admin(request.user):
            return Response(
                {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}},
                status=403,
            )
        audience = request.data.get('audience') or Document.AUDIENCE_ALL_EMPLOYEES
        if audience not in dict(Document.AUDIENCE_CHOICES):
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': f'Unknown audience "{audience}".'}},
                status=400,
            )
        employee_id = request.data.get('employeeId') or request.data.get('employee_id') or None
        requester_employee = getattr(request.user, 'employee', None)
        if employee_id is None:
            if requester_employee is None and not is_hr_admin(request.user):
                return Response(
                    {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'employeeId is required.'}},
                    status=403,
                )
            employee_id = getattr(requester_employee, 'id', None)
        if not is_hr_admin(request.user):
            if not requester_employee or str(requester_employee.id) != str(employee_id):
                return Response(
                    {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'You can only upload documents for yourself.'}},
                    status=403,
                )

        # Organization documents may be filed into a folder and carry a
        # human-entered title/description (employee-attached files leave these
        # blank). An unknown folder id is ignored rather than erroring the upload.
        folder_id = request.data.get('folderId') or request.data.get('folder_id') or None
        if folder_id is not None:
            from .models import DocumentFolder
            if not DocumentFolder.objects.filter(pk=folder_id).exists():
                folder_id = None
        doc = Document.objects.create(
            entity_type=entity_type,
            entity_id=entity_id,
            employee_id=employee_id,
            file=file_obj,
            original_filename=file_obj.name,
            content_type=file_obj.content_type or '',
            size=file_obj.size,
            uploaded_by=request.user,
            expiry_date=request.data.get('expiryDate') or request.data.get('expiry_date') or None,
            audience=audience,
            acknowledgement_required=_to_bool(
                request.data.get('acknowledgementRequired', request.data.get('acknowledgement_required', False))
            ),
            folder_id=folder_id,
            title=(request.data.get('title') or '').strip(),
            description=request.data.get('description') or '',
        )
        write_audit(request.user, 'document.upload', doc.entity_type, doc.entity_id, {'documentId': str(doc.id), 'filename': doc.original_filename})
        return Response({'success': True, 'data': DocumentSerializer(doc, context={'request': request}).data}, status=201)


class DocumentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        if not can_access(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        return Response({'success': True, 'data': DocumentSerializer(doc, context={'request': request}).data})

    def delete(self, request, pk):
        """The "edit" a document supports is delete-and-re-upload — a
        candidate correcting a wrong file, or HR removing something
        inappropriate/misfiled. Either the original uploader or HR Admin
        may delete; nobody else (not even the document's own subject
        employee, if they weren't the uploader — e.g. HR uploaded it on
        their behalf)."""
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        is_uploader = doc.uploaded_by_id == request.user.id
        if not (is_uploader or is_hr_admin(request.user)):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)

        write_audit(request.user, 'document.delete', doc.entity_type, doc.entity_id, {
            'documentId': str(doc.id), 'filename': doc.original_filename,
        })
        doc.file.delete(save=False)
        doc.delete()
        return Response(status=204)


def _serve_document_file(request, doc, mode: str):
    """Shared bytes-serving core for the view (`?mode=view`, inline) and
    download (`?mode=download` / `/download`, attachment) endpoints. Every
    read is logged with who, when, and from where (`DocumentAccessLog`)."""
    DocumentAccessLog.objects.create(
        document=doc,
        action=DocumentAccessLog.ACTION_DOWNLOADED if mode == 'download' else DocumentAccessLog.ACTION_VIEWED,
        performed_by=request.user,
        ip_address=_client_ip(request),
    )

    content_type, _ = mimetypes.guess_type(doc.original_filename)
    response = FileResponse(doc.file.open('rb'), content_type=content_type or 'application/octet-stream')
    disposition = 'attachment' if mode == 'download' else 'inline'
    response['Content-Disposition'] = f'{disposition}; filename="{doc.original_filename}"'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


class DocumentFileView(APIView):
    """`GET /documents/{id}/file?mode=view|download` — the only way a
    document's actual bytes are ever served. Nothing in this API exposes the
    underlying MEDIA_URL/storage path directly (see DocumentSerializer):
    every "View file"/"Download" action in the frontend goes through this
    endpoint instead, so the same `can_access` permission check that gates
    metadata also gates the file itself, and every read is logged with who,
    when, and from where (`DocumentAccessLog`) — not just uploads/deletes,
    which `audit.AuditLog` already covered.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            raise Http404
        if not can_access(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        if not doc.file:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'File not found'}}, status=404)

        mode = 'download' if request.query_params.get('mode') == 'download' else 'view'
        return _serve_document_file(request, doc, mode)


class DocumentDownloadView(APIView):
    """`GET /documents/{id}/download` — always serves the bytes as an
    attachment (save-as). Same `can_access` gate and access logging as the
    file view; a separate route (rather than only `?mode=download`) so API
    clients and the conformance suite have one stable download URL."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            raise Http404
        if not can_access(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        if not doc.file:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'File not found'}}, status=404)
        return _serve_document_file(request, doc, 'download')


def _employee_display_name(emp) -> str:
    name = f"{getattr(emp, 'first_name', '') or ''} {getattr(emp, 'last_name', '') or ''}".strip()
    return name or getattr(emp, 'employee_code', None) or str(emp)


class DocumentAcknowledgeView(APIView):
    """`POST /documents/{id}/acknowledge` — the signed-in employee records that
    they have acknowledged this document. Only valid for a document they can
    see (`can_access`) that actually requires acknowledgement. Idempotent: a
    second POST is a no-op (unique (document, employee)), still 204."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        if not can_access(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        if not doc.acknowledgement_required:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'This document does not require acknowledgement.'}},
                status=400,
            )
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return Response(
                {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Only employees can acknowledge documents.'}},
                status=403,
            )
        DocumentAcknowledgement.objects.get_or_create(document=doc, employee=employee)
        write_audit(request.user, 'document.acknowledge', doc.entity_type, doc.entity_id, {'documentId': str(doc.id)})
        return Response(status=204)


class DocumentAcknowledgementStatusView(APIView):
    """`GET /documents/{id}/acknowledgements` — SCOPE-FILTERED acknowledgement
    status for HR / a manager. The target population is every employee WITHIN
    THE CALLER'S SCOPE who can actually see the document (`can_access`, which
    is audience-aware) — so an hr_only doc counts only HR people, an
    all_employees doc counts everyone in scope, etc. A plain employee with no
    oversight over anyone but themselves gets 403.

    Response: {total, acknowledged, pending, items:[{employee, name,
    acknowledged, acknowledgedAt}]}."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)

        hr = is_hr_admin(request.user)
        caller_emp = getattr(request.user, 'employee', None)
        caller_id = getattr(caller_emp, 'id', None)
        # Oversight population = who this caller manages/sees (employees.read
        # scope), the same notion of "manager visibility" the audience rules
        # use. HR Admin sees everyone.
        from employees.models import Employee
        if hr:
            scope_ids = set(Employee.objects.values_list('pk', flat=True))
        else:
            scope_ids = set(visible_employee_ids(request.user, 'employees.read'))
            # No oversight beyond self -> this is not an HR/manager view.
            if not scope_ids or scope_ids <= {caller_id}:
                return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)

        # ponytail: O(n) can_access scan (one scope resolve per employee). Fine
        # for a directory of ~150; batch/precompute audience sets if it grows.
        scope_employees = Employee.objects.filter(pk__in=scope_ids).select_related('user')
        target = [e for e in scope_employees if getattr(e, 'user', None) is not None and can_access(e.user, doc)]

        acked = {
            a.employee_id: a.acknowledged_at
            for a in DocumentAcknowledgement.objects.filter(document=doc, employee_id__in=[e.id for e in target])
        }
        items = [
            {
                'employee': e.id,
                'name': _employee_display_name(e),
                'acknowledged': e.id in acked,
                'acknowledgedAt': acked[e.id].isoformat() if e.id in acked else None,
            }
            for e in target
        ]
        total = len(items)
        acknowledged = sum(1 for i in items if i['acknowledged'])
        return Response({
            'success': True,
            'data': {
                'total': total,
                'acknowledged': acknowledged,
                'pending': total - acknowledged,
                'items': items,
            },
        })


class PendingAcknowledgementView(APIView):
    """`GET /documents/pending-acknowledgement` — documents the signed-in
    employee still has to acknowledge: acknowledgement-required, visible to
    them (`can_access`, audience-aware), and not yet acknowledged."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = getattr(request.user, 'employee', None)
        if employee is None:
            return Response({'success': True, 'data': []})
        acked_ids = set(
            DocumentAcknowledgement.objects.filter(employee=employee).values_list('document_id', flat=True)
        )
        pending = [
            d for d in Document.objects.filter(acknowledgement_required=True).exclude(id__in=acked_ids)
            if can_access(request.user, d)
        ]
        data = [
            {
                'id': d.id,
                'title': d.original_filename or d.original_name,
                'originalFilename': d.original_filename or d.original_name,
                'description': '',
                'uploadedAt': d.uploaded_at.isoformat() if d.uploaded_at else None,
                'expiryDate': d.expiry_date.isoformat() if d.expiry_date else None,
            }
            for d in pending
        ]
        return Response({'success': True, 'data': data})


def _can_manage_folders(user) -> bool:
    """Who may create/edit/delete folders and see PRIVATE folders. Folders are
    org-wide admin objects, so this is HR Admin only — NOT documents.write,
    which every employee holds at SELF scope (user_has_permission ignores tier)
    and would wrongly let any employee administer folders."""
    return is_hr_admin(user)


def _org_doc_dict(d):
    return {
        'id': d.id,
        'title': d.title or d.original_filename or d.original_name,
        'originalFilename': d.original_filename or d.original_name,
        'description': d.description or '',
        'audience': d.audience,
        'acknowledgementRequired': d.acknowledgement_required,
        'expiryDate': d.expiry_date.isoformat() if d.expiry_date else None,
        'size': d.size,
        'folderId': d.folder_id,
        'uploadedAt': d.uploaded_at.isoformat() if d.uploaded_at else None,
    }


def _folder_dict(f, doc_count):
    return {
        'id': f.id,
        'name': f.name,
        'visibility': f.visibility,
        'description': f.description or '',
        'documentCount': doc_count,
    }


class FolderListCreateView(APIView):
    """`GET /documents/folders` — folders visible to the caller (PUBLIC to all,
    PRIVATE to folder-managers only), each with its org-document count.
    `POST` (manager only) creates a folder {name, visibility, description}."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.db.models import Count, Q
        from .models import DocumentFolder
        qs = DocumentFolder.objects.annotate(
            doc_count=Count('documents', filter=Q(documents__entity_type='organization_document'))
        )
        if not _can_manage_folders(request.user):
            qs = qs.filter(visibility=DocumentFolder.VISIBILITY_PUBLIC)
        data = [_folder_dict(f, f.doc_count) for f in qs]
        return Response({'success': True, 'data': data})

    def post(self, request):
        from .models import DocumentFolder
        if not _can_manage_folders(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        name = (request.data.get('name') or '').strip()
        if not name:
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'name is required'}}, status=400)
        visibility = request.data.get('visibility') or DocumentFolder.VISIBILITY_PUBLIC
        if visibility not in dict(DocumentFolder.VISIBILITY_CHOICES):
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': f'Unknown visibility "{visibility}".'}}, status=400)
        f = DocumentFolder.objects.create(
            name=name, visibility=visibility, description=request.data.get('description') or '',
            created_by=request.user,
        )
        write_audit(request.user, 'document_folder.create', 'document_folder', str(f.id), {'name': f.name})
        return Response({'success': True, 'data': _folder_dict(f, 0)}, status=201)


class FolderDetailView(APIView):
    """`PATCH`/`DELETE /documents/folders/<id>` (manager only). Delete detaches
    documents (SET_NULL), it never deletes them."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        from .models import DocumentFolder
        if not _can_manage_folders(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        try:
            f = DocumentFolder.objects.get(pk=pk)
        except DocumentFolder.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Folder not found'}}, status=404)
        if 'name' in request.data:
            name = (request.data.get('name') or '').strip()
            if not name:
                return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'name cannot be empty'}}, status=400)
            f.name = name
        if 'visibility' in request.data:
            visibility = request.data.get('visibility')
            if visibility not in dict(DocumentFolder.VISIBILITY_CHOICES):
                return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': f'Unknown visibility "{visibility}".'}}, status=400)
            f.visibility = visibility
        if 'description' in request.data:
            f.description = request.data.get('description') or ''
        f.save()
        return Response({'success': True, 'data': _folder_dict(f, f.documents.filter(entity_type='organization_document').count())})

    def delete(self, request, pk):
        from .models import DocumentFolder
        if not _can_manage_folders(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        try:
            f = DocumentFolder.objects.get(pk=pk)
        except DocumentFolder.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Folder not found'}}, status=404)
        write_audit(request.user, 'document_folder.delete', 'document_folder', str(f.id), {'name': f.name})
        f.delete()  # Document.folder is SET_NULL -> documents survive, unfiled.
        return Response(status=204)


class FolderDocumentsView(APIView):
    """`GET /documents/folders/<id>/documents` — the organization documents in
    a folder the caller may see (audience-filtered via can_access)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from .models import DocumentFolder
        try:
            f = DocumentFolder.objects.get(pk=pk)
        except DocumentFolder.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Folder not found'}}, status=404)
        if f.visibility == DocumentFolder.VISIBILITY_PRIVATE and not _can_manage_folders(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        docs = [
            d for d in Document.objects.filter(folder=f, entity_type='organization_document')
            if can_access(request.user, d)
        ]
        return Response({'success': True, 'data': [_org_doc_dict(d) for d in docs]})


class DocumentRemindAcknowledgementView(APIView):
    """`POST /documents/<id>/remind-acknowledgement` (manager only) — send a
    notification to every in-scope employee who still hasn't acknowledged this
    ack-required document. Returns {notified}."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from employees.models import Employee
        from notifications.service import notify
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        if not _can_manage_folders(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        if not doc.acknowledgement_required:
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'This document does not require acknowledgement.'}}, status=400)

        if is_hr_admin(request.user):
            scope_ids = set(Employee.objects.values_list('pk', flat=True))
        else:
            scope_ids = set(visible_employee_ids(request.user, 'employees.read'))
        acked = set(DocumentAcknowledgement.objects.filter(document=doc).values_list('employee_id', flat=True))
        title = doc.title or doc.original_filename or 'a document'
        notified = 0
        for e in Employee.objects.filter(pk__in=scope_ids).select_related('user'):
            if e.id in acked or getattr(e, 'user', None) is None:
                continue
            if not can_access(e.user, doc):
                continue
            notify(e.user, 'document.acknowledgement_reminder', 'Action required: acknowledge a document',
                   f'Please review and acknowledge "{title}".')
            notified += 1
        return Response({'success': True, 'data': {'notified': notified}})


# ---------------------------------------------------------------------------
# Employee Documents verification workflow (Org > Employee Documents).


_VERIFIABLE_ENTITY_TYPES = frozenset(t for t in ENTITY_PERMISSIONS if t != 'organization_document')
"""Employee-subject document types the verification workflow covers: the
generic employee_document bucket, the onboarding file types, and the
employee-owned career buckets. Organization-wide policy docs are excluded —
they carry the acknowledgement workflow instead."""


def _can_verify(user, doc) -> bool:
    """HR Admin may verify anything. Otherwise the caller needs oversight of
    the document's subject employee (employees.read scope covering them, and
    oversight beyond self) — the same manager notion the acknowledgement
    status view uses. Plain employees (even the document's owner) get 403:
    verification is an HR/manager action, never self-service."""
    if is_hr_admin(user):
        return True
    subject_id = _subject_employee_id(doc)
    if subject_id is None:
        return False
    caller_id = getattr(getattr(user, 'employee', None), 'id', None)
    scope_ids = set(visible_employee_ids(user, 'employees.read'))
    if not scope_ids or scope_ids <= {caller_id}:
        return False
    return subject_id in scope_ids


def _owner_user(doc):
    emp = getattr(doc, 'employee', None)
    return getattr(emp, 'user', None)


class PendingVerificationView(APIView):
    """`GET /documents/pending-verification` — employee-submitted documents
    awaiting verification, scope-filtered: HR/managers see pending docs for
    employees in their scope (`can_access`, audience-aware); a plain employee
    sees only their own pending docs."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        pending = Document.objects.filter(
            verification_status=Document.VERIFICATION_PENDING,
            entity_type__in=_VERIFIABLE_ENTITY_TYPES,
        ).select_related('uploaded_by', 'verified_by')
        visible = [d for d in pending if can_access(request.user, d)]
        return Response({'success': True, 'data': DocumentSerializer(visible, many=True, context={'request': request}).data})


class ExpiringDocumentsView(APIView):
    """`GET /documents/expiring?days=30` — documents with an expiry_date on or
    before today + N days (overdue ones included — they need action most),
    scope-filtered via `can_access` like the list view."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = int(request.query_params.get('days', '30'))
        except (TypeError, ValueError):
            days = None
        if days is None or days < 0:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'days must be a non-negative integer.'}},
                status=400,
            )
        cutoff = timezone.localdate() + timezone.timedelta(days=days)
        expiring = Document.objects.filter(expiry_date__isnull=False, expiry_date__lte=cutoff).select_related(
            'uploaded_by', 'verified_by'
        )
        visible = [d for d in expiring if can_access(request.user, d)]
        return Response({'success': True, 'data': DocumentSerializer(visible, many=True, context={'request': request}).data})


class DocumentVerifyView(APIView):
    """`POST /documents/{id}/verify` — mark verified (HR/manager in scope).
    Clears any earlier rejection reason; records who verified and when."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        if not _can_verify(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        doc.verification_status = Document.VERIFICATION_VERIFIED
        doc.verified_by = request.user
        doc.verified_at = timezone.now()
        doc.rejection_reason = ''
        doc.save()
        write_audit(request.user, 'document.verify', doc.entity_type, doc.entity_id, {'documentId': str(doc.id)})
        return Response({'success': True, 'data': DocumentSerializer(doc, context={'request': request}).data})


class DocumentRejectView(APIView):
    """`POST /documents/{id}/reject {reason}` — mark rejected (HR/manager in
    scope). `reason` is required and stored; the document's owner is notified
    so they know what to fix and resubmit."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from notifications.service import notify
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        if not _can_verify(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'reason is required.'}},
                status=400,
            )
        doc.verification_status = Document.VERIFICATION_REJECTED
        doc.verified_by = request.user
        doc.verified_at = timezone.now()
        doc.rejection_reason = reason
        doc.save()
        owner = _owner_user(doc)
        if owner is not None:
            title = doc.original_filename or doc.original_name or 'your document'
            notify(owner, 'document.rejected', 'A document was rejected',
                   f'"{title}" was rejected: {reason}')
        write_audit(request.user, 'document.reject', doc.entity_type, doc.entity_id, {'documentId': str(doc.id)})
        return Response({'success': True, 'data': DocumentSerializer(doc, context={'request': request}).data})


class DocumentNudgeView(APIView):
    """`POST /documents/{id}/nudge` — HR/manager in scope nudges the document's
    owner to act (the pending-on-employee poke). Returns {notified: 1}."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from notifications.service import notify
        try:
            doc = Document.objects.get(pk=pk)
        except Document.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Document not found'}}, status=404)
        if not _can_verify(request.user, doc):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'Not permitted'}}, status=403)
        owner = _owner_user(doc)
        if owner is None:
            return Response(
                {'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'This document has no owner to notify.'}},
                status=400,
            )
        title = doc.original_filename or doc.original_name or 'a document'
        notify(owner, 'document.nudge', 'Action required on a document',
               f'Please review "{title}" — HR is waiting on it.')
        write_audit(request.user, 'document.nudge', doc.entity_type, doc.entity_id, {'documentId': str(doc.id)})
        return Response({'success': True, 'data': {'notified': 1}})
