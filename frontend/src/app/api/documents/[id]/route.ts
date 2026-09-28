import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id> -> Django /documents/<id> (GET/DELETE).
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/documents/${id}`);
  if (sessionExpired || status === 401) {
    const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
    clearAuthCookies(resp);
    return resp;
  }
  const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to load document' } }, { status: status || 502 });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/documents/${id}`, { method: 'DELETE' });
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
  const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to delete document' } }, { status: status || 502 });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}
