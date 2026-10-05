import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/documents/folders/${id}/documents`);
  if (sessionExpired || status === 401) {
    const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
    clearAuthCookies(resp);
    return resp;
  }
  const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to load folder documents' } }, { status: status || 502 });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}
