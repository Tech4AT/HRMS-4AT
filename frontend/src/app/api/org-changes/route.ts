import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// The org-changes list/create live at the backend collection root `/org-changes/`.
// The sibling [...path] route only matches sub-paths (detail, cancel), so the
// bare collection needs its own handler — otherwise `/api/org-changes` 404s and
// the Overview + change screens read empty. Trailing slash matters (APPEND_SLASH).
async function passthrough(req: NextRequest, init: RequestInit) {
  try {
    const backendPath = `/org-changes/${req.nextUrl.search}`;
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      backendPath,
      init,
    );
    if (sessionExpired || status === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 },
      );
      clearAuthCookies(resp);
      return resp;
    }
    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Org changes request failed' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/org-changes] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Org changes request failed' } },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return passthrough(req, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const text = await req.text();
  return passthrough(req, { method: 'POST', body: text });
}
