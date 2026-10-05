import { NextRequest, NextResponse } from 'next/server';
import { createBackendProxyRoute } from '@/lib/api/proxy';

/**
 * Proxy for the admin screens (access control, employees, organisation
 * structure). Only these backend resources are reachable through it; everything
 * else 404s here, so this route can't be used to call arbitrary backend
 * endpoints. The backend enforces the real permission checks (roles.manage,
 * audit.read, employees.*, org.manage) on every one of them.
 */
const ALLOWED_RESOURCES = new Set([
  'roles',
  'permissions',
  'role-permissions',
  'users',
  'user-permission-overrides',
  'audit-log',
  // employee and organisation management
  'employees',
  'org',
  // read-only pickers (anyone with directory access may read these)
  'departments',
  'designations',
  'locations',
  'legal-entities',
  'business-units',
  'cost-centers',
]);

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Ctx = { params: Promise<{ path?: string[] }> };

function handler(method: Method) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    const { path = [] } = await ctx.params;
    const [resource, ...rest] = path;

    // `users/me...` belongs to the signed-in user's own routes, not admin.
    if (!resource || !ALLOWED_RESOURCES.has(resource) || (resource === 'users' && rest[0] === 'me')) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Not found', fields: {} } },
        { status: 404 },
      );
    }

    // createBackendProxyRoute already appends the backend's trailing slash
    // (e.g. /roles/5/). Forward the subpath as-is — adding our own '' segment
    // here double-slashes any multi-segment path (employees/me/profile -> //),
    // which the backend 404s.
    return createBackendProxyRoute(resource)[method](req, {
      params: Promise.resolve({ path: rest }),
    });
  };
}

export const GET = handler('GET');
export const POST = handler('POST');
export const PATCH = handler('PATCH');
export const PUT = handler('PUT');
export const DELETE = handler('DELETE');
