import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/folders -> Django /documents/folders
// (organization-document folder rail: list visible folders / create one).
async function forward(req: NextRequest, method: 'GET' | 'POST') {
  const init: { method: string; body?: string } = { method };
  if (method === 'POST') {
    const text = await req.text();
    if (text) init.body = text;
  }
  const { status, body, rotated, sessionExpired } = await proxyToBackend(req, '/documents/folders', init);
  if (sessionExpired || status === 401) {
    const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
    clearAuthCookies(resp);
    return resp;
  }
  const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed' } }, { status: status || 502 });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}

export const GET = (req: NextRequest) => forward(req, 'GET');
export const POST = (req: NextRequest) => forward(req, 'POST');
