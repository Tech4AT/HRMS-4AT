import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

type RouteContext = { params: Promise<{ id: string }> };

async function forward(req: NextRequest, id: string, method: 'PATCH' | 'DELETE') {
  const init: { method: string; body?: string } = { method };
  if (method === 'PATCH') {
    const text = await req.text();
    if (text) init.body = text;
  }
  const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/documents/folders/${id}`, init);
  if (sessionExpired || status === 401) {
    const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
    clearAuthCookies(resp);
    return resp;
  }
  if (status === 204) {
    const resp = new NextResponse(null, { status: 204 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  }
  const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed' } }, { status: status || 502 });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return forward(req, id, 'PATCH');
}
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return forward(req, id, 'DELETE');
}
