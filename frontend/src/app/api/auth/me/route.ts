import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, setAuthCookies, clearAuthCookies } from '@/lib/api/proxy';
import { MOCK_AUTH_ENABLED, MOCK_REFRESH_TOKEN, MOCK_USER } from '@/lib/api/mock-auth';

// Previously this file guessed the frontend archetype from the backend
// role's free-text *name* via a hardcoded table (`{employee: 'employee',
// admin: 'admin', 'super admin': 'superadmin'}`). That broke the moment the
// backend's real role names turned out to be Employee/Manager/HR Admin/Finance
// (docs/REQUIREMENTS.md §0) instead of Employee/Admin/Super Admin — "manager"
// and "hr admin" aren't in the table, so both silently fell through to the
// `|| 'employee'` default, quietly stripping HR Admin and Finance users of
// their admin/superadmin UI entirely. The backend now sends `roles[0].archetype`
// explicitly instead (one of exactly the 3 values this frontend understands:
// employee/admin/superadmin — see backend/core/enums.py's RoleArchetype), so
// there's no name-guessing table to keep in sync as roles change or new
// custom roles get created.
// The backend now sends the single deterministic primary archetype
// explicitly (`archetype`: the most-privileged active role's archetype —
// see backend/core/scope.py::primary_archetype), plus `roles` as the sorted
// list of ACTIVE role names. Older backends sent `roles` as
// [{name, archetype}]; the fallback below keeps those working.
function archetypeFromMe(u: {
  archetype?: string;
  roles?: ({ name?: string; archetype?: string } | string)[] | undefined;
}): string {
  if (u.archetype === 'admin' || u.archetype === 'superadmin' || u.archetype === 'employee') {
    return u.archetype;
  }
  const first = u.roles?.[0];
  const legacy = typeof first === 'object' ? first?.archetype : undefined;
  if (legacy === 'admin' || legacy === 'superadmin' || legacy === 'employee') {
    return legacy;
  }
  return 'employee';
}

export async function GET(req: NextRequest) {
  try {
    if (MOCK_AUTH_ENABLED) {
      const hasSession = req.cookies.get('refreshToken')?.value === MOCK_REFRESH_TOKEN;
      if (!hasSession) {
        return NextResponse.json(
          { success: false, error: { message: 'Unauthorized' } },
          { status: 401 }
        );
      }
      return NextResponse.json({
        success: true,
        data: {
          id: MOCK_USER.id,
          email: MOCK_USER.email,
          firstName: MOCK_USER.firstName,
          lastName: MOCK_USER.lastName,
          role: archetypeFromMe(MOCK_USER),
          permissions: MOCK_USER.permissions,
          scope: MOCK_USER.scope,
          mustChangePassword: false,
        },
      });
    }

    const { status, body, rotated, sessionExpired } = await proxyToBackend(
      req,
      '/users/me'
    );

    if (sessionExpired || status === 401) {
      const resp = NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      );
      clearAuthCookies(resp);
      return resp;
    }

    if (status < 200 || status >= 300 || !body?.data) {
      return NextResponse.json(
        body ?? { success: false, error: { message: 'Failed to get user' } },
        { status: status || 502 }
      );
    }

    const u = body.data;

    const resp = NextResponse.json({
      success: true,
      data: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: archetypeFromMe(u),
        permissions: u.permissions || [],
        // {kind:'org'} / {kind:'team', employeeIds} / {kind:'self'} - the one
        // resolved scope value for this user's requests (see backend
        // core/scope.py::resolve_management_scope). Falls back to self,
        // matching the backend's own fail-closed default, for callers against
        // an older backend that doesn't send it yet.
        scope: u.scope || { kind: 'self' },
        // Forced temporary-password change gate (T06): an admin-issued
        // password must be replaced before the user reaches the app.
        // Defaults to false for older backends that don't send it yet.
        mustChangePassword: u.mustChangePassword ?? false,
      },
    });

    if (rotated) {
      setAuthCookies(resp, rotated.accessToken, rotated.refreshToken);
    }

    return resp;
  } catch (err) {
    console.error('[api/auth/me] failed:', err);
    return NextResponse.json(
      { success: false, error: { message: 'Failed to get user' } },
      { status: 500 }
    );
  }
}
