import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

export async function GET(req: NextRequest) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      '/legal-entities'
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
      body ?? { success: false, error: { message: 'Failed to load legal entities' } },
      { status: status || 502 }
    );

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch (err) {
    console.error('[api/legal-entities] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to load legal entities' } },
      { status: 500 }
    );
  }
}
