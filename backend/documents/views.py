import mimetypes
import os

from django.http import FileResponse, Http404
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import write_audit
from core.scope import is_hr_admin

from .access import can_access
from .models import Document, DocumentAccessLog
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


class DocumentListUploadView(APIView):
    """`GET /documents?entityType=&entityId=` and `POST /documents`
    (multipart: file, entityType, entityId, employeeId, expiryDate?). A new
    hire's preboarding checklist can attach any number of documents to the
    same task (e.g. front + back of an ID, several certificates) — nothing
    here limits it to one; the "one document per task" behavior that used
    to exist was purely a frontend UI choice (auto-completing the task on
    first upload), not a backend rule."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        entity_type = request.query_params.get('entityType')
        entity_id = request.query_params.get('entityId')
        qs = Document.objects.all()
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if entity_id:
            qs = qs.filter(entity_id=entity_id)
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
        # themselves.
        employee_id = request.data.get('employeeId') or None
        requester_employee = getattr(request.user, 'employee', None)
        if not is_hr_admin(request.user):
            if not requester_employee or str(requester_employee.id) != str(employee_id):
                return Response(
                    {'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'You can only upload documents for yourself.'}},
                    status=403,
                )

        doc = Document.objects.create(
            entity_type=request.data.get('entityType', ''),
            entity_id=request.data.get('entityId', ''),
            employee_id=employee_id,
            file=file_obj,
            original_filename=file_obj.name,
            uploaded_by=request.user,
            expiry_date=request.data.get('expiryDate') or None,
        )
        write_audit(request.user, 'document.upload', doc.entity_type, doc.entity_id, {'documentId': doc.id, 'filename': doc.original_filename})
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
            'documentId': doc.id, 'filename': doc.original_filename,
        })
        doc.file.delete(save=False)
        doc.delete()
        return Response(status=204)


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
