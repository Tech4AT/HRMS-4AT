"""Success-envelope helpers matching the frontend contract: `{success, data}`."""
from rest_framework.response import Response


def ok(data=None, status=200):
    return Response({'success': True, 'data': data}, status=status)
