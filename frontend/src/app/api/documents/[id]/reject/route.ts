import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id>/reject (POST {reason}) -> Django
// /documents/<id>/reject (W1: HR/manager rejects; reason required, owner
// notified).
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const text = await req.text();
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/documents/${id}/reject`,
      { method: 'POST', body: text || undefined },
    );
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to reject document' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/reject] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to reject document' } },
      { status: 500 },
    );
  }
}
