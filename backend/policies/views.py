from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.scope import is_hr_admin

from .models import CompanyPolicy, PolicyAcknowledgment


def _policy_data(policy, employee=None, acked_ids=None):
    acked = False
    if employee and acked_ids is not None:
        acked = policy.id in acked_ids
    return {
        'id': policy.id,
        'title': policy.title,
        'description': policy.description,
        'documentId': policy.document_id,
        'documentUrl': f'/api/documents/{policy.document_id}/file' if policy.document_id else None,
        'requiresAcknowledgment': policy.requires_acknowledgment,
        'isActive': policy.is_active,
        'createdAt': policy.created_at,
        'acknowledged': acked,
        'acknowledgmentCount': None,
    }


class PolicyListView(APIView):
    """GET /policies  — employee: active policies with ack status
       POST /policies — HR admin: create a policy"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = CompanyPolicy.objects.filter(is_active=True)
        employee = getattr(request.user, 'employee', None)
        acked_ids: set[int] = set()
        if employee:
            acked_ids = set(
                PolicyAcknowledgment.objects.filter(employee=employee).values_list('policy_id', flat=True)
            )
        data = [_policy_data(p, employee, acked_ids) for p in qs]
        return Response({'success': True, 'data': data})

    def post(self, request):
        if not is_hr_admin(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'HR Admin only'}}, status=403)
        title = (request.data.get('title') or '').strip()
        if not title:
            return Response({'success': False, 'error': {'code': 'VALIDATION_ERROR', 'message': 'title is required'}}, status=400)
        policy = CompanyPolicy.objects.create(
            title=title,
            description=(request.data.get('description') or '').strip(),
            document_id=request.data.get('documentId') or None,
            requires_acknowledgment=bool(request.data.get('requiresAcknowledgment', True)),
            created_by=request.user,
        )
        return Response({'success': True, 'data': _policy_data(policy)}, status=201)


class PolicyAdminListView(APIView):
    """GET /policies/admin — HR admin: all policies with acknowledgment counts"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_hr_admin(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'HR Admin only'}}, status=403)
        policies = CompanyPolicy.objects.all()
        data = []
        for p in policies:
            row = _policy_data(p)
            row['acknowledgmentCount'] = PolicyAcknowledgment.objects.filter(policy=p).count()
            data.append(row)
        return Response({'success': True, 'data': data})


class PolicyDetailView(APIView):
    """PATCH /policies/{id} — HR admin: update; DELETE: deactivate"""

    permission_classes = [IsAuthenticated]

    def _get(self, pk):
        try:
            return CompanyPolicy.objects.get(pk=pk)
        except CompanyPolicy.DoesNotExist:
            return None

    def patch(self, request, pk):
        if not is_hr_admin(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'HR Admin only'}}, status=403)
        policy = self._get(pk)
        if not policy:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Policy not found'}}, status=404)
        if 'title' in request.data:
            policy.title = (request.data['title'] or '').strip()
        if 'description' in request.data:
            policy.description = (request.data['description'] or '').strip()
        if 'documentId' in request.data:
            policy.document_id = request.data['documentId'] or None
        if 'requiresAcknowledgment' in request.data:
            policy.requires_acknowledgment = bool(request.data['requiresAcknowledgment'])
        if 'isActive' in request.data:
            policy.is_active = bool(request.data['isActive'])
        policy.save()
        return Response({'success': True, 'data': _policy_data(policy)})

    def delete(self, request, pk):
        if not is_hr_admin(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'HR Admin only'}}, status=403)
        policy = self._get(pk)
        if not policy:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Policy not found'}}, status=404)
        policy.is_active = False
        policy.save()
        return Response(status=204)


class PolicyAcknowledgeView(APIView):
    """POST /policies/{id}/acknowledge — mark as acknowledged for the signed-in employee"""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        employee = getattr(request.user, 'employee', None)
        if not employee:
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'No employee record found'}}, status=403)
        try:
            policy = CompanyPolicy.objects.get(pk=pk, is_active=True)
        except CompanyPolicy.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Policy not found'}}, status=404)
        PolicyAcknowledgment.objects.get_or_create(policy=policy, employee=employee)
        return Response({'success': True, 'data': {'acknowledged': True}})


class PolicyAcknowledgmentsView(APIView):
    """GET /policies/{id}/acknowledgments — HR admin: who has/hasn't acknowledged"""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not is_hr_admin(request.user):
            return Response({'success': False, 'error': {'code': 'FORBIDDEN', 'message': 'HR Admin only'}}, status=403)
        try:
            policy = CompanyPolicy.objects.get(pk=pk)
        except CompanyPolicy.DoesNotExist:
            return Response({'success': False, 'error': {'code': 'NOT_FOUND', 'message': 'Policy not found'}}, status=404)
        acks = PolicyAcknowledgment.objects.filter(policy=policy).select_related('employee')
        data = [
            {
                'employeeId': a.employee_id,
                'employeeName': a.employee.full_name or str(a.employee_id),
                'employeeCode': getattr(a.employee, 'employee_code', ''),
                'acknowledgedAt': a.acknowledged_at,
            }
            for a in acks
        ]
        return Response({'success': True, 'data': data})
