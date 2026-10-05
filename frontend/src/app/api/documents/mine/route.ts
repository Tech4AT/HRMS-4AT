import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

export async function GET(req: NextRequest) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, '/documents/mine');

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to load your documents' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/mine] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load your documents' } }, { status: 500 });
  }
}
