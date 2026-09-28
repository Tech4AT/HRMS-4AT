import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

async function handle(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    const init: RequestInit = { method: req.method };
    if (req.method !== 'GET') {
      const text = await req.text();
      if (text) init.body = text;
    }
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/policies${qs}`, init);
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(body ?? { success: false }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/policies] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Request failed' } }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
