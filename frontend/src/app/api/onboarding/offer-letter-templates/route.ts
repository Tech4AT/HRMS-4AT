import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, proxyFormDataToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// This path shadows the /api/onboarding/[...path] catch-all (Next.js
// matches the more specific route first) — needed because template create
// may carry a multipart .docx upload, which createBackendProxyRoute's plain
// JSON proxy can't forward correctly.

export async function GET(req: NextRequest) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, '/onboarding/offer-letter-templates');

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to load templates' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/offer-letter-templates] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load templates' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const { status, body, rotated, sessionExpired } = await proxyFormDataToBackend(
      req,
      '/onboarding/offer-letter-templates',
      formData,
      'POST',
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to create template' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/offer-letter-templates] create failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to create template' } }, { status: 500 });
  }
}
