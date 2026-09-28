import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, setAuthCookies, clearAuthCookies } from '@/lib/api/proxy';

/** Change the signed-in user's own password (including replacing an
 * admin-issued temporary password — T06). The backend revokes every session
 * and returns a fresh token pair, which must be persisted as cookies. */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      '/users/me/change-password',
      { method: 'POST', body: JSON.stringify(payload) }
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
      clearAuthCookies(resp);
      return resp;
    }

    if (status < 200 || status >= 300) {
      return NextResponse.json(
        body ?? { success: false, error: { message: 'Failed to change password' } },
        { status: status || 502 }
      );
    }

    const resp = NextResponse.json(body);

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch {
    return NextResponse.json(
      { success: false, error: { message: 'Failed to change password' } },
      { status: 500 }
    );
  }
}
