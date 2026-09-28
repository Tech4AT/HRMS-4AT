import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_API_URL } from '@/lib/api/backend';
import { setAuthCookies } from '@/lib/api/proxy';

// Browser -> /api/auth/set-password/<token> -> Django /auth/set-password/<token>.
// Deliberately not `createBackendProxyRoute`/`proxyToBackend` (those read the
// accessToken/refreshToken cookies) — the candidate has no session yet; the
// token in the URL is the only credential. Mirrors app/api/auth/login/route.ts,
// including setting the auth cookies on a successful POST so the candidate
// lands in the app already signed in.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const response = await fetch(`${BACKEND_API_URL}/auth/set-password/${encodeURIComponent(token)}`);
    const data = await response.json().catch(() => null);
    return NextResponse.json(data ?? { success: false, error: { message: 'Upstream error' } }, { status: response.status || 502 });
  } catch {
    return NextResponse.json({ success: false, error: { message: 'Failed to check link' } }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const { password, confirmPassword } = await req.json();

    const response = await fetch(`${BACKEND_API_URL}/auth/set-password/${encodeURIComponent(token)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      return NextResponse.json(data ?? { success: false, error: { message: 'Failed to set password' } }, { status: response.status || 400 });
    }

    const resp = NextResponse.json({
      success: true,
      data: {
        user: {
          id: data.data.user.id,
          email: data.data.user.email,
          firstName: data.data.user.firstName,
          lastName: data.data.user.lastName,
          role: 'employee',
          permissions: [],
        },
      },
    });
    setAuthCookies(resp, data.data.accessToken, data.data.refreshToken);
    return resp;
  } catch {
    return NextResponse.json({ success: false, error: { message: 'Failed to set password' } }, { status: 500 });
  }
}
