import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_API_URL } from '@/lib/api/backend';
import { clearAuthCookies } from '@/lib/api/proxy';
import { MOCK_AUTH_ENABLED } from '@/lib/api/mock-auth';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refreshToken')?.value;

  if (refreshToken && !MOCK_AUTH_ENABLED) {
    // Revoke the refresh token server-side. Best-effort — never block logout on it.
    try {
      await fetch(`${BACKEND_API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // ignore
    }
  }

  const resp = NextResponse.json({ success: true });
  clearAuthCookies(resp);
  // Clear mock user email cookie if mock auth is enabled
  if (MOCK_AUTH_ENABLED) {
    resp.cookies.delete('mockUserEmail');
  }
  return resp;
}
