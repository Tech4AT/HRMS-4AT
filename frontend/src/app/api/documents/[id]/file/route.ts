import { NextRequest, NextResponse } from 'next/server';
import { proxyBinaryFromBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/documents/<id>/file?mode=view|download -> Django
// /documents/<id>/file. The success response here is the file's raw bytes,
// not the JSON envelope, so this shadows the plain [id] proxy the same way
// the onboarding documents ZIP download does (see
// app/api/onboarding/records/[id]/documents/download-all/route.ts).
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const mode = req.nextUrl.searchParams.get('mode');
    const backendPath = `/documents/${id}/file${mode ? `?mode=${encodeURIComponent(mode)}` : ''}`;
    const result = await proxyBinaryFromBackend(req, backendPath);

    if (result.sessionExpired || result.status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    if (result.status !== 200 || !result.arrayBuffer) {
      return NextResponse.json(
        result.body ?? { success: false, error: { message: 'Failed to load file' } },
        { status: result.status || 502 },
      );
    }

    const resp = new NextResponse(result.arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType || 'application/octet-stream',
        'Content-Disposition': result.contentDisposition || 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    if (result.rotated) setAuthCookies(resp, result.rotated.accessToken, result.rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/documents/[id]/file] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to load file' } }, { status: 500 });
  }
}
