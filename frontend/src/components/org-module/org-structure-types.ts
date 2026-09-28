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
 * - LegalEntity / BusinessUnit / Location / Level / Grade = name only
 *   (SoftDeleteNamedModel: name + is_active; NO description field).
 * - CostCenter = name + code.
 * - Department = name + parent (+ parent_name / child_count on the admin
 *   serializer only).
 * - NO head FK, NO Band model, NO address/timezone/map fields anywhere.
 * Anything beyond that renders DISABLED with a "not stored yet" hint.
 */

import type { OrgEmployee } from '@/lib/api/org';

export type UnitKind =
  | 'legal-entities'
  | 'business-units'
  | 'locations'
  | 'departments'
  | 'cost-centers'
  | 'grades'
  | 'bands';

/** One row in the left rail. Extra real fields are merged in when known. */
export interface UnitItem {
  id: string;
  name: string;
  /** Cost Center finance code (real, from the read serializer). */
  code?: string;
  /** Department parent (real, merged from the admin list when permitted). */
  parentId?: string | null;
  parentName?: string | null;
  childCount?: number;
}

export type EmployeeKey =
  | 'legal_entity_id'
  | 'business_unit_id'
  | 'location_id'
  | 'department_id'
  | 'cost_center_id'
  | 'grade_id';

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
  /** Whether the add/edit drawer persists `code` (Cost Center only). */
  hasCode: boolean;
  /** Whether the unit supports a parent picker (Department only). */
  hasParent: boolean;
  /** Whether an Employees tab + count is shown. */
  hasEmployees: boolean;
  /** Keka-only fields to render disabled with a "not stored yet" hint. */
  disabledFields: { label: string; hint?: string }[];
}

export const TYPE_CONFIGS: TypeConfig[] = [
  {
    kind: 'legal-entities',
    label: 'Legal Entities',
    singular: 'Legal Entity',
    plural: 'Legal Entities',
    adminResource: 'legal-entities',
    employeeKey: 'legal_entity_id',
    hasCode: false,
    hasParent: false,
    hasEmployees: true,
    disabledFields: [
      { label: 'CIN / Registration no.' },
      { label: 'Date of incorporation' },
      { label: 'Type / Sector / Nature of business' },
      { label: 'Registered address, city, state, ZIP' },
      { label: 'Currency' },
      { label: 'Financial year' },
      { label: 'Company logo' },
    ],
  },
  {
    kind: 'business-units',
    label: 'Business Unit',
    singular: 'Business Unit',
    plural: 'Business Units',
    adminResource: 'business-units',
    employeeKey: 'business_unit_id',
    hasCode: false,
    hasParent: false,
    hasEmployees: false,
    disabledFields: [
      { label: 'Unit code' },
      { label: 'Unit head' },
      { label: 'Cost allocation %' },
    ],
  },
  {
    kind: 'locations',
    label: 'Location',
    singular: 'Location',
    plural: 'Locations',
    adminResource: 'locations',
    employeeKey: 'location_id',
    hasCode: false,
    hasParent: false,
    hasEmployees: true,
    disabledFields: [
      { label: 'Timezone' },
      { label: 'Country / State' },
      { label: 'Address' },
      { label: 'Map pin' },
    ],
  },
  {
    kind: 'departments',
    label: 'Department',
    singular: 'Department',
    plural: 'Departments',
    adminResource: 'departments',
    employeeKey: 'department_id',
    hasCode: false,
    hasParent: true,
    hasEmployees: true,
    disabledFields: [{ label: 'Department code' }, { label: 'Department head' }],
  },
  {
    kind: 'cost-centers',
    label: 'Cost Center',
    singular: 'Cost Center',
    plural: 'Cost Centers',
    adminResource: 'cost-centers',
    employeeKey: 'cost_center_id',
    hasCode: true,
    hasParent: false,
    hasEmployees: true,
    disabledFields: [{ label: 'Cost center head' }, { label: 'Budget owner' }],
  },
  {
    kind: 'grades',
    label: 'Pay Grades',
    singular: 'Pay Grade',
    plural: 'Pay Grades',
    adminResource: 'grades',
    employeeKey: 'grade_id',
    hasCode: false,
    hasParent: false,
    hasEmployees: true,
    disabledFields: [{ label: 'Pay range (min / max)' }, { label: 'Currency' }],
  },
  {
    kind: 'bands',
    label: 'Bands',
    singular: 'Band',
    plural: 'Bands',
    adminResource: null,
    employeeKey: null,
    hasCode: false,
    hasParent: false,
    hasEmployees: false,
    disabledFields: [],
  },
];

export function configFor(kind: UnitKind): TypeConfig {
  const found = TYPE_CONFIGS.find((c) => c.kind === kind);
  if (!found) throw new Error(`Unknown org-structure tab: ${kind}`);
  return found;
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
    error?: { message?: string | string[] };
    detail?: string;
  } | null = null;
  try {
    json = (await res.json()) as {
      success?: boolean;
      data?: unknown;
      results?: unknown;
      error?: { message?: string | string[] };
      detail?: string;
    };
  } catch {
    json = null;
  }

  if (!res.ok || json?.success === false) {
    const raw = json?.error?.message ?? json?.detail;
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
  parent?: string | null;
  is_active?: boolean;
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

/** Admin list row (camelCase renderer): subset of fields we merge in. */
export interface AdminUnitRow {
  id: number | string;
  name: string;
  employeeCount?: number;
  parent?: number | string | null;
  parentName?: string | null;
  childCount?: number;
}

/**
 * GET /api/admin/org/<resource>/ — real admin list (camelCase, paginated).
 * Returns null when the caller may not read it (non-managers); the screen
 * falls back to the read-only list. Used to enrich departments with
 * parent/child/employee counts.
 */
export async function adminList(resource: string): Promise<AdminUnitRow[] | null> {
  const res = await fetch(baseFor(resource), { credentials: 'include' });
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
  // grade_id rides on the directory serializer but is not in the shared
  // OrgEmployee interface — read through a record view instead of edits.
  return employees.filter((e) => ((e as unknown as Record<string, unknown>)[key] as string | null) === id);
}
