import { NextRequest, NextResponse } from 'next/server';
import { proxyBinaryFromBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Shadows /api/onboarding/[...path] for this one path — the success response
// here is a ZIP file, not the JSON envelope, which the plain catch-all proxy
// can't forward (it always calls res.json() on the backend response).

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await proxyBinaryFromBackend(req, `/onboarding/records/${id}/documents/download-all`);

    if (result.sessionExpired || result.status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    if (result.status !== 200 || !result.arrayBuffer) {
      return NextResponse.json(
        result.body ?? { success: false, error: { message: 'Failed to download documents' } },
        { status: result.status || 502 },
      );
    }

    const resp = new NextResponse(result.arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType || 'application/zip',
        'Content-Disposition': result.contentDisposition || 'attachment; filename="documents.zip"',
      },
    });
    if (result.rotated) setAuthCookies(resp, result.rotated.accessToken, result.rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/records/[id]/documents/download-all] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to download documents' } }, { status: 500 });
  }
}
