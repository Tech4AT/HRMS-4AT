import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/expiring?days=30 -> Django
// /documents/expiring (W1: docs expiring within N days, scope-filtered).
export async function GET(req: NextRequest) {
  try {
    const days = req.nextUrl.searchParams.get('days') ?? '30';
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/documents/expiring?days=${encodeURIComponent(days)}`,
    );
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to load expiring documents' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/expiring] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to load expiring documents' } },
      { status: 500 },
    );
  }
}
