import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id>/acknowledge -> Django /documents/<id>/acknowledge (POST).
// The signed-in employee records that they acknowledged the document; the
// backend is idempotent and returns 204.
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/documents/${id}/acknowledge`, { method: 'POST' });
  if (sessionExpired || status === 401) {
    const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
    clearAuthCookies(resp);
    return resp;
  }
  if (status === 204) {
    const resp = new NextResponse(null, { status: 204 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  }
  const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to acknowledge document' } }, { status: status || 502 });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}
