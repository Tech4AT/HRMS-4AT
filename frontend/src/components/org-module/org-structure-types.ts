'use client';

/**
 * Shared types + admin CRUD client for the unified Org Structure screen.
 *
 * Reads reuse the proven read-only endpoints in `@/lib/api/org` (snake_case
 * `{success, data}` with a bare array). Writes go to the real audited admin
 * viewsets (`org.manage`) through the `/api/admin/org/<resource>/` proxy —
 * note the TRAILING SLASH on every URL: the proxy appends it for us and
 * Django's APPEND_SLASH 500s detail writes without it (this repo's
 * recurring trap).
 *
 * MODEL REALITY (backend/employees/models.py + serializers.py, verified):
 * - Every master (LegalEntity, BusinessUnit, Location, Department,
 *   CostCenter, Team, JobFamily, Level, Grade, JobTitle) extends
 *   SoftDeleteNamedModel: name + code + description + is_active, all stored.
 *   The drawer edits all three; the detail panel shows all three.
 * - Extra stored columns per master are declared as `extraFields` on each
 *   TypeConfig below (FK picker sources included) — the drawer and the
 *   detail panel both render from that single spec, so they cannot drift.
 * - NO Band model exists: the Bands tab stays an honest empty state.
 */

import type { OrgEmployee } from '@/lib/api/org';

export type UnitKind =
  | 'legal-entities'
  | 'business-units'
  | 'locations'
  | 'departments'
  | 'teams'
  | 'cost-centers'
  | 'job-families'
  | 'levels'
  | 'grades'
  | 'job-titles'
  | 'bands';

/** Where an FK picker's options come from. */
export type FkTarget =
  | 'employee'
  | 'department'
  | 'location'
  | 'legal-entity'
  | 'business-unit'
  | 'cost-center'
  | 'job-family'
  | 'level'
  | 'job-title';

export interface ExtraField {
  /** snake_case write key (what the admin endpoint consumes). */
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'fk' | 'select';
  /** Which master/employee list feeds an `fk` picker. */
  fk?: FkTarget;
  /** Static choices for a `select` (e.g. Location.type). */
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
}

/** One row in the left rail. `admin` is the merged camelCase admin row. */
export interface UnitItem {
  id: string;
  name: string;
  /** Finance/HR short code (stored on every master). */
  code?: string;
  /** Free text shown on the admin screens (stored on every master). */
  description?: string;
  /** Department / business-unit / job-family parent (merged from admin). */
  parentId?: string | null;
  parentName?: string | null;
  childCount?: number;
  /** Full camelCase admin row (employeeCount, *_name fields, rank, …). */
  admin?: Record<string, unknown>;
}

export type EmployeeKey =
  | 'legal_entity_id'
  | 'business_unit_id'
  | 'location_id'
  | 'department_id'
  | 'cost_center_id'
  | 'level_id'
  | 'grade_id'
  | 'designation_id';

export interface TypeConfig {
  kind: UnitKind;
  /** Sub-tab label. */
  label: string;
  singular: string;
  /** "ACTIVE <THING> (N)" rail header noun, plural. */
  plural: string;
  /** Admin resource under /api/admin/org/<resource>/ ; null = no backend. */
  adminResource: string | null;
  /** Directory key that links employees to this unit; null = not linkable. */
  employeeKey: EmployeeKey | null;
  /** Whether the unit supports a parent picker (Department only). */
  hasParent: boolean;
  /** Whether an Employees tab + count is shown. */
  hasEmployees: boolean;
  /** Stored extra columns, rendered by the drawer AND the detail panel. */
  extraFields: ExtraField[];
  /** Keka-only fields to render disabled with a "not stored yet" hint. */
  disabledFields: { label: string; hint?: string }[];
}

const EMPLOYEE_FK = (key: string, label: string, hint?: string): ExtraField => ({
  key,
  label,
  type: 'fk',
  fk: 'employee',
  hint,
});

export const TYPE_CONFIGS: TypeConfig[] = [
  {
    kind: 'legal-entities',
    label: 'Legal Entities',
    singular: 'Legal Entity',
    plural: 'Legal Entities',
    adminResource: 'legal-entities',
    employeeKey: 'legal_entity_id',
    hasParent: false,
    hasEmployees: true,
    extraFields: [
      { key: 'registered_address', label: 'Registered address', type: 'fk', fk: 'location' },
      { key: 'country', label: 'Country', type: 'text', placeholder: 'e.g. India' },
      { key: 'currency', label: 'Currency', type: 'text', placeholder: 'e.g. INR' },
      { key: 'logo', label: 'Logo URL', type: 'text', placeholder: 'https://…' },
    ],
    disabledFields: [
      { label: 'CIN / Registration no.', hint: 'Tax and registration columns live in the payroll module, not here.' },
      { label: 'Date of incorporation' },
      { label: 'Type / Sector / Nature of business' },
      { label: 'Financial year' },
    ],
  },
  {
    kind: 'business-units',
    label: 'Business Unit',
    singular: 'Business Unit',
    plural: 'Business Units',
    adminResource: 'business-units',
    employeeKey: 'business_unit_id',
    hasParent: false,
    hasEmployees: false,
    extraFields: [
      { key: 'parent', label: 'Parent unit (division tier)', type: 'fk', fk: 'business-unit' },
      { key: 'legal_entity', label: 'Legal entity', type: 'fk', fk: 'legal-entity' },
      EMPLOYEE_FK('head', 'Unit head'),
    ],
    disabledFields: [{ label: 'Cost allocation %' }],
  },
  {
    kind: 'locations',
    label: 'Location',
    singular: 'Location',
    plural: 'Locations',
    adminResource: 'locations',
    employeeKey: 'location_id',
    hasParent: false,
    hasEmployees: true,
    extraFields: [
      { key: 'address_line1', label: 'Address line 1', type: 'text' },
      { key: 'address_line2', label: 'Address line 2', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'postal_code', label: 'Postal code', type: 'text' },
      { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'e.g. Asia/Kolkata' },
      { key: 'latitude', label: 'Latitude', type: 'text', placeholder: 'e.g. 12.9716' },
      { key: 'longitude', label: 'Longitude', type: 'text', placeholder: 'e.g. 77.5946' },
      {
        key: 'type',
        label: 'Location type',
        type: 'select',
        options: [
          { value: 'hq', label: 'Headquarters' },
          { value: 'branch', label: 'Branch' },
          { value: 'remote', label: 'Remote' },
        ],
      },
    ],
    disabledFields: [{ label: 'Map pin', hint: 'Use latitude/longitude above — there is no map picker yet.' }],
  },
  {
    kind: 'departments',
    label: 'Department',
    singular: 'Department',
    plural: 'Departments',
    adminResource: 'departments',
    employeeKey: 'department_id',
    hasParent: true,
    hasEmployees: true,
    extraFields: [
      EMPLOYEE_FK('head', 'Department head'),
      { key: 'cost_center', label: 'Cost center', type: 'fk', fk: 'cost-center' },
      { key: 'business_unit', label: 'Business unit', type: 'fk', fk: 'business-unit' },
    ],
    disabledFields: [],
  },
  {
    kind: 'teams',
    label: 'Teams',
    singular: 'Team',
    plural: 'Teams',
    adminResource: 'teams',
    employeeKey: null,
    hasParent: false,
    hasEmployees: false,
    extraFields: [
      { key: 'department', label: 'Department', type: 'fk', fk: 'department' },
      EMPLOYEE_FK('lead', 'Team lead'),
    ],
    disabledFields: [],
  },
  {
    kind: 'cost-centers',
    label: 'Cost Center',
    singular: 'Cost Center',
    plural: 'Cost Centers',
    adminResource: 'cost-centers',
    employeeKey: 'cost_center_id',
    hasParent: false,
    hasEmployees: true,
    extraFields: [
      EMPLOYEE_FK('owner', 'Budget owner'),
      { key: 'legal_entity', label: 'Legal entity', type: 'fk', fk: 'legal-entity' },
    ],
    disabledFields: [{ label: 'Cost center head', hint: 'Use the budget owner above — there is no separate head column.' }],
  },
  {
    kind: 'job-families',
    label: 'Job Families',
    singular: 'Job Family',
    plural: 'Job Families',
    adminResource: 'job-families',
    employeeKey: null,
    hasParent: false,
    hasEmployees: false,
    extraFields: [{ key: 'parent', label: 'Parent family', type: 'fk', fk: 'job-family' }],
    disabledFields: [],
  },
  {
    kind: 'levels',
    label: 'Levels',
    singular: 'Level',
    plural: 'Levels',
    adminResource: 'levels',
    employeeKey: 'level_id',
    hasParent: false,
    hasEmployees: true,
    extraFields: [
      { key: 'rank', label: 'Rank (higher = more senior)', type: 'number', placeholder: 'e.g. 3' },
      { key: 'job_family', label: 'Job family (blank = shared)', type: 'fk', fk: 'job-family' },
    ],
    disabledFields: [],
  },
  {
    kind: 'grades',
    label: 'Pay Grades',
    singular: 'Pay Grade',
    plural: 'Pay Grades',
    adminResource: 'grades',
    employeeKey: 'grade_id',
    hasParent: false,
    hasEmployees: true,
    extraFields: [{ key: 'level', label: 'Level', type: 'fk', fk: 'level' }],
    disabledFields: [{ label: 'Pay range (min / max)', hint: 'Money lives in the payroll module, which links to grades later.' }],
  },
  {
    kind: 'job-titles',
    label: 'Job Titles',
    singular: 'Job Title',
    plural: 'Job Titles',
    adminResource: 'job-titles',
    employeeKey: 'designation_id',
    hasParent: false,
    hasEmployees: true,
    extraFields: [
      { key: 'job_family', label: 'Job family', type: 'fk', fk: 'job-family' },
      { key: 'level', label: 'Level', type: 'fk', fk: 'level' },
      { key: 'is_people_manager', label: 'People manager', type: 'boolean' },
    ],
    disabledFields: [],
  },
  {
    kind: 'bands',
    label: 'Bands',
    singular: 'Band',
    plural: 'Bands',
    adminResource: null,
    employeeKey: null,
    hasParent: false,
    hasEmployees: false,
    extraFields: [],
    disabledFields: [],
  },
];

export function configFor(kind: UnitKind): TypeConfig {
  const found = TYPE_CONFIGS.find((c) => c.kind === kind);
  if (!found) throw new Error(`Unknown org-structure tab: ${kind}`);
  return found;
}

/** snake_case write key -> camelCase admin-row key (job_family -> jobFamily). */
export function camelKey(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/* ------------------------- admin CRUD (real writes) ------------------------ */

export class OrgAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OrgAdminError';
  }
}

function baseFor(resource: string): string {
  // Trailing slash is LOAD-BEARING: the admin proxy forwards
  // `/api/admin/org/<resource>/` to Django `/org/<resource>/`, and Django's
  // APPEND_SLASH turns slash-less POST/PATCH/DELETE into a 500.
  return `/api/admin/org/${resource}/`;
}

async function adminRequest<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  let json: {
    success?: boolean;
    data?: unknown;
    results?: unknown;
    error?: { message?: string | string[] } | string;
    detail?: string;
  } | null = null;
  try {
    json = (await res.json()) as {
      success?: boolean;
      data?: unknown;
      results?: unknown;
      error?: { message?: string | string[] } | string;
      detail?: string;
    };
  } catch {
    json = null;
  }

  if (!res.ok || json?.success === false) {
    const errObj = json?.error;
    const raw =
      (typeof errObj === 'string' ? errObj : errObj?.message) ?? json?.detail;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new OrgAdminError(message, res.status);
  }

  const payload = (json?.data ?? json) as T;
  return payload as T;
}

export interface AdminWriteInput {
  name: string;
  code?: string;
  description?: string;
  parent?: string | null;
  is_active?: boolean;
  [key: string]: unknown;
}

/** POST /api/admin/org/<resource>/ — real create (audited, org.manage). */
export function adminCreate<T>(resource: string, input: AdminWriteInput): Promise<T> {
  return adminRequest<T>(baseFor(resource), 'POST', input);
}

/** PATCH /api/admin/org/<resource>/<id>/ — real update (audited). */
export function adminUpdate<T>(resource: string, id: string, input: Partial<AdminWriteInput>): Promise<T> {
  return adminRequest<T>(`${baseFor(resource)}${id}/`, 'PATCH', input);
}

/** DELETE /api/admin/org/<resource>/<id>/ — real delete; 409 when members. */
export function adminDelete(resource: string, id: string): Promise<void> {
  return adminRequest<void>(`${baseFor(resource)}${id}/`, 'DELETE');
}

/** Admin list row (camelCase renderer): the fields we merge in. */
export interface AdminUnitRow {
  id: number | string;
  name: string;
  code?: string;
  description?: string;
  employeeCount?: number;
  positionCount?: number;
  parent?: number | string | null;
  parentName?: string | null;
  childCount?: number;
  [key: string]: unknown;
}

/**
 * GET /api/admin/org/<resource>/?pageSize=1000 — real admin list (camelCase,
 * paginated). Returns null when the caller may not read it (non-managers);
 * the screen falls back to the read-only list. pageSize=1000 is LOAD-BEARING:
 * the default page is 20 rows and silently truncates every master.
 */
export async function adminList(resource: string): Promise<AdminUnitRow[] | null> {
  const res = await fetch(`${baseFor(resource)}?pageSize=1000`, { credentials: 'include' });
  if (!res.ok) return null;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const data = (json as { data?: unknown })?.data ?? json;
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as { results?: unknown })?.results)
      ? ((data as { results?: unknown }).results as AdminUnitRow[])
      : null;
  if (!rows) return null;
  return rows as AdminUnitRow[];
}

/**
 * Merge one kind's read-only names with its admin rows (code, description,
 * parent/child, employee counts, and the full camelCase row for the detail
 * panel). Rows the admin list doesn't know (non-manager view) pass through.
 */
export function mergeAdminRows(items: UnitItem[], adminRows: AdminUnitRow[] | null): UnitItem[] {
  if (!adminRows) return items;
  const byId = new Map(adminRows.map((r) => [String(r.id), r]));
  const names = new Map(adminRows.map((r) => [String(r.id), r.name]));
  return items.map((item) => {
    const row = byId.get(item.id);
    if (!row) return item;
    const pid = row.parent === null || row.parent === undefined ? null : String(row.parent);
    return {
      ...item,
      code: typeof row.code === 'string' ? row.code : item.code,
      description: typeof row.description === 'string' ? row.description : item.description,
      parentId: row.parent === undefined ? item.parentId : pid,
      parentName:
        row.parent === undefined
          ? item.parentName
          : pid
            ? ((names.get(pid) ?? (typeof row.parentName === 'string' ? row.parentName : null)) as string | null)
            : null,
      childCount: typeof row.childCount === 'number' ? row.childCount : item.childCount,
      admin: row as Record<string, unknown>,
    };
  });
}

/* ------------------------------ small helpers ----------------------------- */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fullName(e: Pick<OrgEmployee, 'first_name' | 'last_name'>): string {
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '—';
}

export function membersOf(employees: OrgEmployee[], key: EmployeeKey | null, id: string): OrgEmployee[] {
  if (!key) return [];
  // level_id / grade_id ride on the directory serializer but are not in the
  // shared OrgEmployee interface — read through a record view instead.
  return employees.filter((e) => String((e as unknown as Record<string, unknown>)[key] ?? '') === id);
}
