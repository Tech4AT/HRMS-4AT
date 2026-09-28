import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, proxyFormDataToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    // Trailing slash required: documents/urls.py registers this list/upload
    // endpoint at '' (combined with the '/api/v1/documents/' include
    // prefix, the actual pattern is .../documents/, unlike every other
    // app's list endpoint here, which uses a named sub-path like 'records').
    // Without it, Django's APPEND_SLASH can't redirect a POST without
    // losing the body — see the fix in the POST handler below.
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/documents/${qs}`);

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to load documents' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load documents' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const { status, body, rotated, sessionExpired } = await proxyFormDataToBackend(req, '/documents/', formData);

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Upload failed' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents] upload failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Upload failed' } }, { status: 500 });
  }
}
