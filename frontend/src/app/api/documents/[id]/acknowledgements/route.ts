import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id>/acknowledgements (GET) -> Django
// /documents/<id>/acknowledgements (Parcel A: scope-filtered status list
// {total, acknowledged, pending, items}).
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/documents/${id}/acknowledgements`,
    );
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to load acknowledgement status' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/acknowledgements] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to load acknowledgement status' } },
      { status: 500 },
    );
  }
}
