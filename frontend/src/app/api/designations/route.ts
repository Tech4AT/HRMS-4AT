import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

function handleUnauth(resp: NextResponse) {
  clearAuthCookies(resp);
  return resp;
}

function makeResp(body: unknown, status: number, rotated?: { accessToken: string; refreshToken: string }) {
  const resp = NextResponse.json(body, { status });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}

export async function GET(req: NextRequest) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, '/designations');
    if (sessionExpired || status === 401)
      return handleUnauth(NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 }));
    return makeResp(body ?? { success: false, error: { message: 'Failed to load designations' } }, status || 502, rotated);
  } catch (err) {
    console.error('[api/designations GET] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load designations' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const text = await req.text();
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, '/org/designations/', {
      method: 'POST',
      body: text,
    });
    if (sessionExpired || status === 401)
      return handleUnauth(NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 }));
    return makeResp(body ?? { success: false, error: { message: 'Failed to create designation' } }, status || 502, rotated);
  } catch (err) {
    console.error('[api/designations POST] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to create designation' } }, { status: 500 });
  }
}
