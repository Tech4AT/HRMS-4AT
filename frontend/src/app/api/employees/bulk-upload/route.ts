import { NextRequest, NextResponse } from 'next/server';
import { proxyFormDataToBackend, setAuthCookies, clearAuthCookies } from '@/lib/api/proxy';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const { status, body, rotated, sessionExpired } = await proxyFormDataToBackend(
      req,
      '/employees/bulk-upload/',
      formData,
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 },
      );
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(
      body ?? { success: false, error: { message: 'Upload failed' } },
      { status: status || 502 },
    );
    if (rotated) setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    return resp;
  } catch (err) {
    console.error('[api/employees/bulk-upload] error:', err);
    return NextResponse.json(
      { success: false, error: { message: String(err) } },
      { status: 500 },
    );
  }
}
