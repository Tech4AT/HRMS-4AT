import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, proxyFormDataToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

// Shadows /api/onboarding/[...path] for this one path — PATCH here may
// carry a multipart .docx upload (replacing the template's Word file),
// which the plain JSON catch-all proxy can't forward correctly. DELETE is
// re-implemented here too (plain JSON proxy) since a route file only
// handles the methods it exports — this file otherwise shadowing the
// catch-all would silently 405 it. No GET: the Django detail view doesn't
// define one (only list/create/update/delete are used by the frontend).

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status, body, rotated, sessionExpired } = await proxyToBackend(req, `/onboarding/offer-letter-templates/${id}`, {
      method: 'DELETE',
    });

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = status === 204
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(body ?? { success: false, error: { message: 'Failed to remove template' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/offer-letter-templates/[id]] delete failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to remove template' } }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const formData = await req.formData();
    const { status, body, rotated, sessionExpired } = await proxyFormDataToBackend(
      req,
      `/onboarding/offer-letter-templates/${id}`,
      formData,
      'PATCH',
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json({ success: false, error: { message: 'Unauthorized' } }, { status: 401 });
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(body ?? { success: false, error: { message: 'Failed to update template' } }, { status: status || 502 });
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/onboarding/offer-letter-templates/[id]] update failed:', err);
    return NextResponse.json({ success: false, error: { message: 'Failed to update template' } }, { status: 500 });
  }
}
