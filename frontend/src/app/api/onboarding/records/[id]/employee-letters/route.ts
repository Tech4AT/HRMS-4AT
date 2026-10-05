import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, proxyFormDataToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Shadows the /api/onboarding/[...path] catch-all (Next.js matches the more
// specific route first) — needed because issuing a letter carries a
// multipart file upload, which createBackendProxyRoute's plain JSON proxy
// can't forward correctly (same reason offer-letter-templates has its own
// route — see that file's comment).

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/onboarding/records/${id}/employee-letters`);

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to load letters' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/records/[id]/employee-letters] GET failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load letters' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const formData = await req.formData();
    const { status, body, rotated, sessionExpired } = await proxyFormDataToBackend(
      req,
      `/onboarding/records/${id}/employee-letters`,
      formData,
      'POST',
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to issue letter' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/records/[id]/employee-letters] POST failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to issue letter' } }, { status: 500 });
  }
}
