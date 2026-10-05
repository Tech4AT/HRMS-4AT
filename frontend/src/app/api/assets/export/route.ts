import { NextRequest, NextResponse } from 'next/server';
import { proxyBinaryFromBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Binary sibling of the /api/assets/... JSON proxy: the asset export is a
// `text/csv` attachment, not the JSON envelope the catch-all proxy forwards.
// Static segment, so it shadows /api/assets/[...path] for this one path.
// Mirrors frontend/src/app/api/admin/org/reports/export/route.ts.

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.search;
    const result = await proxyBinaryFromBackend(req, `/assets/export/${qs}`);

    if (result.sessionExpired || result.status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    if (result.status !== 200 || !result.arrayBuffer) {
      return NextResponse.json(
        result.body ?? { success: false, error: { message: 'Failed to export assets' } },
        { status: result.status || 502 },
      );
    }

    const resp = new NextResponse(result.arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': result.contentType || 'text/csv',
        'Content-Disposition': result.contentDisposition || 'attachment; filename="assets.csv"',
      },
    });
    if (result.rotated) setAuthCookies(resp, result.rotated.accessToken, result.rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/assets/export] failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to export assets' } }, { status: 500 });
  }
}
