import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

type Ctx = { params: Promise<{ id: string }> };

function handleUnauth(resp: NextResponse) {
  clearAuthCookies(resp);
  return resp;
}

function makeResp(body: unknown, status: number, rotated?: { accessToken: string; refreshToken: string }) {
  if (status === 204) {
    const resp = new NextResponse(null, { status: 204 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  }
  const resp = NextResponse.json(body, { status });
  if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
  return resp;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const text = await req.text();
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/org/departments/${id}/`, {
      method: 'PATCH',
      body: text,
    });
    if (sessionExpired || status === 401)
      return handleUnauth(NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 }));
    return makeResp(body ?? { success: false, error: { message: 'Failed to update department' } }, status || 502, rotated);
  } catch (err) {
    console.error('[api/departments/[id] PATCH] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to update department' } }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/org/departments/${id}/`, {
      method: 'DELETE',
    });
    if (sessionExpired || status === 401)
      return handleUnauth(NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 }));
    return makeResp(body, status || 502, rotated);
  } catch (err) {
    console.error('[api/departments/[id] DELETE] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to remove department' } }, { status: 500 });
  }
}
