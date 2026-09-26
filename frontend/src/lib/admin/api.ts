// Typed client for the access-control admin screens. Every call goes through
// the whitelisted proxy at /api/admin/[...path].

export type ScopeTier =
  | 'self'
  | 'manager'
  | 'team'
  | 'department'
  | 'location'
  | 'legal_entity'
  | 'all';

/** Plain-language names for the seven reach levels, narrowest to widest. */
export const REACH_OPTIONS: { value: ScopeTier; label: string; hint: string }[] = [
  { value: 'self', label: 'Only themselves', hint: 'Their own records only' },
  { value: 'manager', label: 'Their direct reports', hint: 'Themselves and the people who report to them' },
  { value: 'team', label: 'Their whole team', hint: 'Everyone below them, including indirect reports' },
  { value: 'department', label: 'Their department', hint: 'Everyone in the same department' },
  { value: 'location', label: 'Their location', hint: 'Everyone at the same location' },
  { value: 'legal_entity', label: 'Their legal entity', hint: 'Everyone in the same legal entity' },
  { value: 'all', label: 'Everyone', hint: 'The whole organisation' },
];

export function reachLabel(tier: string | null | undefined): string {
  return REACH_OPTIONS.find((o) => o.value === tier)?.label ?? '—';
}

export type Archetype = 'employee' | 'admin' | 'superadmin';

/** What each role type shows in the app's navigation and pages. */
export const ARCHETYPE_OPTIONS: { value: Archetype; label: string }[] = [
  { value: 'employee', label: 'Standard employee view' },
  { value: 'admin', label: 'Manager view' },
  { value: 'superadmin', label: 'HR administrator view' },
];

export function archetypeLabel(a: string): string {
  return ARCHETYPE_OPTIONS.find((o) => o.value === a)?.label ?? a;
}

export interface Page<T> {
  results: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RoleGrant {
  id: number;
  role: number;
  permission: number;
  permissionCode: string;
  scopeTier: ScopeTier;
}

export interface Role {
  id: number;
  name: string;
  description: string;
  archetype: Archetype;
  isActive: boolean;
  userCount: number;
  permissions: RoleGrant[];
}

export interface Permission {
  id: number;
  code: string;
  /** Short row text (from the module's rbac.py; may be blank on old rows). */
  label: string;
  description: string;
  /** Feature area for grouping (from the module's rbac.py). */
  group: string;
}

export interface AdminUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: number | null;
  roleName: string | null;
  employeeCode: string | null;
  isActive: boolean;
}

export interface Exception {
  id: number;
  user: number;
  userName: string;
  userEmail: string;
  permission: number;
  permissionCode: string;
  scopeTier: ScopeTier;
  isGranted: boolean;
}

export interface AccessPreview {
  permission: string;
  granted: boolean;
  tier: ScopeTier | null;
  source: string;
  reachCount: number;
  totalEmployees: number;
  people: { id: string; name: string; employeeCode: string }[];
  truncated: boolean;
}

export interface AuditEntry {
  id: number;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: number | null;
  actorEmail: string | null;
  actorName: string | null;
  diff: Record<string, unknown>;
}

export class ApiError extends Error {
  status: number;
  fields: Record<string, string[]>;
  constructor(message: string, status: number, fields: Record<string, string[]> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
  }
  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new ApiError(
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      body?.error?.fields ?? {},
    );
  }
  // Custom actions answer {success, data}; ordinary resources answer the object itself.
  return (body && typeof body === 'object' && 'success' in body && 'data' in body ? body.data : body) as T;
}

export const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export const adminApi = {
  // roles
  listRoles: () => request<Page<Role>>(`roles/${qs({ pageSize: 100 })}`),
  createRole: (body: { name: string; description?: string; archetype: Archetype }) =>
    request<Role>('roles/', { method: 'POST', body }),
  updateRole: (
    id: number,
    body: Partial<{ name: string; description: string; archetype: Archetype; isActive: boolean }>,
  ) =>
    request<Role>(`roles/${id}/`, { method: 'PATCH', body }),
  deleteRole: (id: number) => request<void>(`roles/${id}/`, { method: 'DELETE' }),
  listPermissions: () => request<Page<Permission>>(`permissions/${qs({ pageSize: 100 })}`),

  // what a role grants
  addGrant: (role: number, permission: number, scopeTier: ScopeTier) =>
    request<RoleGrant>('role-permissions/', { method: 'POST', body: { role, permission, scopeTier } }),
  changeGrant: (id: number, scopeTier: ScopeTier) =>
    request<RoleGrant>(`role-permissions/${id}/`, { method: 'PATCH', body: { scopeTier } }),
  removeGrant: (id: number) => request<void>(`role-permissions/${id}/`, { method: 'DELETE' }),

  // people
  listUsers: (p: { search?: string; page?: number; pageSize?: number }) =>
    request<Page<AdminUser>>(`users/${qs(p)}`),
  updateUser: (id: number, body: Partial<{ role: number; isActive: boolean }>) =>
    request<AdminUser>(`users/${id}/`, { method: 'PATCH', body }),
  resetPassword: (id: number) =>
    request<{ temporaryPassword: string }>(`users/${id}/reset-password/`, { method: 'POST', body: {} }),
  revokeSessions: (id: number) =>
    request<{ revokedCount: number }>(`users/${id}/revoke-sessions/`, { method: 'POST', body: {} }),
  accessPreview: (id: number, permission: string) =>
    request<AccessPreview>(`users/${id}/access-preview/${qs({ permission })}`),

  // personal exceptions
  listExceptions: (p: { user?: number; permission?: number; page?: number; pageSize?: number }) =>
    request<Page<Exception>>(`user-permission-overrides/${qs(p)}`),
  addException: (body: { user: number; permission: number; scopeTier: ScopeTier; isGranted: boolean }) =>
    request<Exception>('user-permission-overrides/', { method: 'POST', body }),
  removeException: (id: number) =>
    request<void>(`user-permission-overrides/${id}/`, { method: 'DELETE' }),

  // activity log
  listAudit: (p: {
    search?: string;
    action?: string;
    entity_type?: string;
    entity_id?: string;
    page?: number;
    pageSize?: number;
  }) =>
    request<Page<AuditEntry>>(`audit-log/${qs(p)}`),
};

/** "Role.created" -> "Role created", "auth.login_failed" -> "Login failed". */
export function humanizeAction(action: string): string {
  const cleaned = action
    .replace(/^auth\./, '')
    .replace(/^user\./, 'User ')
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
