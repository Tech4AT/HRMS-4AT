import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, clearAuthCookies, setAuthCookies } from '@/lib/api/proxy';

async function passthrough(
  req: NextRequest,
  backendPath: string,
  init: RequestInit,
  fallbackMessage: string,
) {
  try {
    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      backendPath,
      init,
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
      clearAuthCookies(resp);
      return resp;
    }

    const resp = NextResponse.json(
      body ?? { success: false, error: { message: fallbackMessage } },
      { status: status || 502 }
    );

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch (err) {
    console.error('[api/employees] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: fallbackMessage } },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return passthrough(req, `/employees${req.nextUrl.search}`, {}, 'Failed to load employees');
}

// Creating an employee persists a real Employee row (EmployeeWriteSerializer:
// first_name + work_email + employee_code required, manager optional), so the
// new person shows up in /api/org-directory — directory and chart — at once.
export async function POST(req: NextRequest) {
  const text = await req.text();
  return passthrough(
    req,
    '/employees',
    { method: 'POST', body: text },
    'Failed to create employee',
  );
}
