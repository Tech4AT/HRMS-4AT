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

/** Employee Reports (Org Dashboard > Employee Reports). Shapes mirror the
 * backend's snake_case {success, data} envelope, unwrapped by `request`. */
export interface ReportCard {
  id: string;
  title: string;
  description: string;
  wired: boolean;
  unavailable?: string | null;
  customizable?: boolean;
}

export interface ReportCategory {
  id: string;
  label: string;
  reports: ReportCard[];
}

export interface ReportFieldGroup {
  name: string;
  fields: { key: string; label: string }[];
  count: number;
}

export interface ReportCatalog {
  categories: ReportCategory[];
  field_groups: ReportFieldGroup[];
}

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportPayload {
  type: string;
  title: string;
  description: string;
  category: string;
  wired: boolean;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  total: number;
  unavailable: string | null;
  custom?: { id: number; name: string };
}

export interface SavedReport {
  id: number;
  name: string;
  base_type: string;
  selected_fields: string[];
  filters: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export type ReportFilters = {
  business_unit?: string;
  department?: string;
  location?: string;
  cost_center?: string;
  legal_entity?: string;
  band?: string;
};

/** Rows -> CSV text (client-side download; the backend also serves CSV at
 * org/reports/export/ for API users). */
export function reportRowsToCsv(
  columns: ReportColumn[],
  rows: Record<string, string | number | null>[],
): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(','));
  return lines.join('\n');
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
  /** Membership list (user ids) — reflects current M2M membership. */
  users: number[];
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
  /** Every role membership (ordered by name). A user may hold zero, one, or many. */
  roles: { id: number; name: string }[];
  /** Size of the user's true effective permission set (union across active
   * roles + overrides + baseline − denies), as computed by the backend. */
  permissionCount: number;
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

/** One bucket of GET org/analytics/summary/ or headcount?by=. `id` null = Unassigned. */
export interface HeadcountBucket {
  id: string | null;
  name: string;
  headcount: number;
}

/** Grade/level dimensions carry no assignments yet: the backend returns a
 * withheld marker instead of buckets until HR assigns them. */
export interface WithheldDimension {
  withheld: string;
  detail: string;
}

export function isWithheld(
  v: HeadcountBucket[] | WithheldDimension | undefined,
): v is WithheldDimension {
  return !!v && !Array.isArray(v) && typeof (v as WithheldDimension).withheld === 'string';
}

export interface OrgAnalyticsSummary {
  total_headcount: number;
  total_records: number;
  by_department: HeadcountBucket[];
  by_location: HeadcountBucket[];
  by_business_unit: HeadcountBucket[];
  by_employment_type: HeadcountBucket[];
  by_status: HeadcountBucket[];
  by_grade: HeadcountBucket[] | WithheldDimension;
  by_level: HeadcountBucket[] | WithheldDimension;
  /** Metrics with no source data (gender, age, tenure, growth, attrition_rate)
   * map to a human-readable reason; never charted. */
  unavailable: Record<string, string>;
}

export type OrgHeadcountDimension =
  | 'department'
  | 'location'
  | 'business_unit'
  | 'cost_center'
  | 'legal_entity'
  | 'grade'
  | 'level'
  | 'employment_type'
  | 'work_mode'
  | 'status';

export const HEADCOUNT_DIMENSIONS: { value: OrgHeadcountDimension; label: string }[] = [
  { value: 'department', label: 'Department' },
  { value: 'location', label: 'Location' },
  { value: 'business_unit', label: 'Business unit' },
  { value: 'employment_type', label: 'Employment type' },
  { value: 'work_mode', label: 'Work mode' },
  { value: 'status', label: 'Status' },
];

export interface HeadcountResponse {
  dimension: string;
  buckets: HeadcountBucket[];
  total: number;
}

/** Category filter values accepted by GET org/employee-activity/. */
export const EMPLOYEE_ACTIVITY_CATEGORIES = [
  'login',
  'profile',
  'role',
  'lifecycle',
  'orgchange',
  'structure',
  'other',
] as const;

export type EmployeeActivityCategory = (typeof EMPLOYEE_ACTIVITY_CATEGORIES)[number];

export interface EmployeeActivityEntry {
  id: number;
  occurredAt: string;
  action: string;
  category: string;
  employee: { id: number; code: string; name: string } | null;
  actor: { id: number; email: string; name: string; employee_id: number | null } | null;
  summary: string;
  entityType: string;
  entityId: string;
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
  // Catalog is ~107 and grows slowly; 500 (max_page_size 1000) fetches all in
  // one page. ponytail: single-page fetch, paginate if the catalog ever nears 500.
  listPermissions: () => request<Page<Permission>>(`permissions/${qs({ pageSize: 500 })}`),

  // what a role grants
  addGrant: (role: number, permission: number, scopeTier: ScopeTier) =>
    request<RoleGrant>('role-permissions/', { method: 'POST', body: { role, permission, scopeTier } }),
  changeGrant: (id: number, scopeTier: ScopeTier) =>
    request<RoleGrant>(`role-permissions/${id}/`, { method: 'PATCH', body: { scopeTier } }),
  removeGrant: (id: number) => request<void>(`role-permissions/${id}/`, { method: 'DELETE' }),

  // people
  listUsers: (p: { search?: string; page?: number; pageSize?: number }) =>
    request<Page<AdminUser>>(`users/${qs(p)}`),
  updateUser: (id: number, body: Partial<{ roleIds: number[]; isActive: boolean }>) =>
    request<AdminUser>(`users/${id}/`, { method: 'PATCH', body }),
  addUsersToRole: (roleId: number, userIds: number[]) =>
    request<Role>(`roles/${roleId}/add-users/`, { method: 'POST', body: { userIds } }),
  removeUsersFromRole: (roleId: number, userIds: number[]) =>
    request<Role>(`roles/${roleId}/remove-users/`, { method: 'POST', body: { userIds } }),
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

  // organisation analytics (org.read-gated, snake_case {success, data})
  getOrgAnalyticsSummary: () =>
    request<OrgAnalyticsSummary>('org/analytics/summary/'),
  getOrgHeadcount: (
    by: OrgHeadcountDimension,
    filters: Record<string, string | undefined> = {},
  ) =>
    request<HeadcountResponse>(`org/analytics/headcount/${qs({ by, ...filters })}`),

  // per-employee activity feed (audit.read-gated, camelCase Page)
  listEmployeeActivity: (p: {
    employee?: string;
    category?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    pageSize?: number;
  }) =>
    request<Page<EmployeeActivityEntry>>(`org/employee-activity/${qs(p)}`),

  // employee reports (org.read-gated, snake_case {success, data})
  getReportCatalog: () => request<ReportCatalog>('org/reports/catalog/'),
  runReport: (
    type: string,
    filters: Record<string, string | undefined> = {},
    columns?: string[],
  ) =>
    request<ReportPayload>(
      `org/reports/run/${qs({ type, ...filters, ...(columns?.length ? { columns: columns.join(',') } : {}) })}`,
    ),
  runSavedReport: (id: number, filters: Record<string, string | undefined> = {}) =>
    request<ReportPayload>(`org/reports/run/${qs({ custom: id, ...filters })}`),
  listCustomReports: () => request<Page<SavedReport>>('org/reports/custom/'),
  createCustomReport: (body: {
    name: string;
    base_type: string;
    selected_fields: string[];
    filters: Record<string, string>;
  }) => request<SavedReport>('org/reports/custom/', { method: 'POST', body }),
  updateCustomReport: (
    id: number,
    body: Partial<{ name: string; selected_fields: string[]; filters: Record<string, string> }>,
  ) => request<SavedReport>(`org/reports/custom/${id}/`, { method: 'PATCH', body }),
  deleteCustomReport: (id: number) =>
    request<void>(`org/reports/custom/${id}/`, { method: 'DELETE' }),
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
