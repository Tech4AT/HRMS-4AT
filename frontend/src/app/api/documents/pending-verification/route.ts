import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/pending-verification -> Django
// /documents/pending-verification (W1: employee docs awaiting verification
// in the caller's scope).
export async function GET(req: NextRequest) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      '/documents/pending-verification',
    );
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to load pending verifications' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/pending-verification] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to load pending verifications' } },
      { status: 500 },
    );
  }
}
