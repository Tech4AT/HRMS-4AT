import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id>/acknowledge (POST) -> Django
// /documents/<id>/acknowledge (Parcel A: current employee acknowledges).
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const text = await req.text();
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/documents/${id}/acknowledge`,
      { method: 'POST', body: text || undefined },
    );
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
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to acknowledge document' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/acknowledge] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to acknowledge document' } },
      { status: 500 },
    );
  }
}
