import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const pathStr = path ? `/${path.join('/')}` : '';
    const qs = req.nextUrl.search;
    const { status: respStatus, body: respBody, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/employees${pathStr}${qs}`
    );

    if (sessionExpired || respStatus === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(
      respBody ?? { success: false, error: { message: 'Failed to load' } },
      { status: respStatus || 502 }
    );

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch (err) {
    console.error('[api/employees/[...path]] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to load' } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await params;
    const pathStr = path ? `/${path.join('/')}` : '';
    const qs = req.nextUrl.search;

    // Read the body for multipart forwarding
    const body = await req.blob();

    const { status: respStatus, body: respBody, rotated, sessionExpired } = await proxyToBackend(
      req,
      `/employees${pathStr}${qs}`,
      { isMultipart: true, method: 'POST', body }
    );

    if (sessionExpired || respStatus === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(
      respBody ?? { success: false, error: { message: 'Failed to upload' } },
      { status: respStatus || 502 }
    );

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch (err) {
    console.error('[api/employees/[...path]] POST failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to upload' } },
      { status: 500 }
    );
  }
}
