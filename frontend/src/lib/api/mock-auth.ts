/**
 * Temporary auth bypass for local frontend work while the Django backend
 * (see docs/TASKS.md Phase 1) doesn't exist yet. Enabled via `MOCK_AUTH=true`
 * in `.env.local`. Every route handler under `app/api/auth/*` and
 * `app/api/users/me` checks this flag first and, when on, short-circuits
 * before ever calling `BACKEND_API_URL` - the real login screen, AuthProvider,
 * and cookie-based session flow all run unmodified against these fake values.
 *
 * Remove all `MOCK_AUTH_ENABLED` branches (and this file) once the real
 * backend's `/auth/*` and `/users/me` endpoints are live.
 */
export const MOCK_AUTH_ENABLED = process.env.MOCK_AUTH === 'true';

export const MOCK_ACCESS_TOKEN = 'mock-access-token';
export const MOCK_REFRESH_TOKEN = 'mock-refresh-token';

export const MOCK_USER = {
  id: 'mock-user-1',
  email: 'demo@elevate-hr.local',
  firstName: 'Demo',
  lastName: 'User',
  roles: [{ name: 'HR Admin', archetype: 'superadmin' }],
  permissions: [
    'employee.read',
    'employee.write',
    'attendance.read.self',
    'attendance.read.team',
    'attendance.approve',
    'leave.approve',
    'expense.approve',
    'calendar.manage',
    'scope.all',
  ],
  scope: { kind: 'org' as const },
};
