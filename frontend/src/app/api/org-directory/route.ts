import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Company-wide org directory: forwards to the backend's unscoped /org-directory
// so the Organisation page's chart and directory show the whole company to every
// authenticated user, regardless of RBAC scope.
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/org-directory${qs}`
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Failed to load org directory' } },
      { status: status || 502 }
    );

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch (err) {
    console.error('[api/org-directory] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to load org directory' } },
      { status: 500 }
    );
  }
}
