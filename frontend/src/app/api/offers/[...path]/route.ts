import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_API_URL } from '@/lib/api/backend';

/**
 * Browser -> /api/offers/... -> Django /offers/... — deliberately NOT
 * `createBackendProxyRoute` (lib/api/proxy.ts): that helper reads the
 * accessToken/refreshToken auth cookies, which a candidate signing an offer
 * doesn't have (no HRMS login exists for them until they accept). The
 * secure token already in the URL path is the only credential this route
 * needs to forward — see backend/onboarding/views_public.py.
 */
type RouteContext = { params: Promise<{ path?: string[] }> };

async function forward(req: NextRequest, ctx: RouteContext, method: string) {
  const { path = [] } = await ctx.params;
  const backendPath = `/offers/${path.join('/')}${req.nextUrl.search}`;

  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET') {
    const text = await req.text();
    if (text) init.body = text;
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_API_URL}${backendPath}`, init);
  } catch {
    return NextResponse.json({ success: false, error: { message: 'Upstream error' } }, { status: 502 });
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, { status: res.status, headers: { 'Content-Type': 'application/pdf' } });
  }

  const body = await res.json().catch(() => null);
  return NextResponse.json(body ?? { success: false, error: { message: 'Upstream error' } }, { status: res.status || 502 });
}

export const GET = (req: NextRequest, ctx: RouteContext) => forward(req, ctx, 'GET');
export const POST = (req: NextRequest, ctx: RouteContext) => forward(req, ctx, 'POST');
