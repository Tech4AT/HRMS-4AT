import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id>/nudge (POST) -> Django
// /documents/<id>/nudge (W1: HR/manager nudges the document's owner to act).
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/documents/${id}/nudge`,
      { method: 'POST' },
    );
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to send nudge' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/nudge] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to send nudge' } },
      { status: 500 },
    );
  }
}
