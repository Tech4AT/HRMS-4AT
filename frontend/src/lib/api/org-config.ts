/**
 * Browser-side client for the org config endpoints (org.manage, camelCase):
 * - /api/admin/org/org-settings/          (OrgSetting key/value rows)
 * - /api/admin/org/code-schemes/          (+ <id>/next-code/ POST)
 * - /api/admin/org/hierarchy-rules/       (+ /validate POST)
 *
 * The `/api/admin/org/` proxy forwards to Django `/org/...` (see
 * app/api/admin/[...path]/route.ts ALLOWED_RESOURCES), so no new proxy route
 * was needed. Trailing slashes are LOAD-BEARING (Django APPEND_SLASH 500s
 * slash-less writes); lists take ?pageSize=1000 (default page is 20 rows).
 * Writes stay snake_case — the backend's CamelCaseJSONParser passes them
 * through (proven live on the Org Structure screen).
 */

import { OrgAdminError } from '@/components/org-module/org-structure-types';

function baseFor(resource: string): string {
  return `/api/admin/org/${resource}/`;
}

interface ErrorEnvelope {
  success?: boolean;
  data?: unknown;
  error?: { message?: string | string[] } | string;
  detail?: string;
}

function errorMessage(json: ErrorEnvelope | null, status: number): string {
  const errObj = json?.error;
  const raw = (typeof errObj === 'string' ? errObj : errObj?.message) ?? json?.detail;
  return Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${status})`;
}

async function configList<T>(resource: string): Promise<T[]> {
  const res = await fetch(`${baseFor(resource)}?pageSize=1000`, { credentials: 'include' });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
  }
  if (!res.ok) {
    let json: ErrorEnvelope | null = null;
    try {
      json = (await res.json()) as ErrorEnvelope;
    } catch {
      json = null;
    }
    throw new OrgAdminError(errorMessage(json, res.status), res.status);
  }
  const json = (await res.json()) as ErrorEnvelope & { results?: unknown };
  const data = json?.data ?? json;
  const rows = Array.isArray(data) ? data : Array.isArray((data as { results?: unknown })?.results)
    ? ((data as { results?: unknown }).results as T[])
    : [];
  return rows as T[];
}

async function configWrite<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: ErrorEnvelope | null = null;
  try {
    json = (await res.json()) as ErrorEnvelope;
  } catch {
    json = null;
  }
  if (!res.ok || json?.success === false) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new OrgAdminError(errorMessage(json, res.status), res.status);
  }
  return (json?.data ?? json) as T;
}

async function configDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (res.status === 204) return;
  let json: ErrorEnvelope | null = null;
  try {
    json = (await res.json()) as ErrorEnvelope;
  } catch {
    json = null;
  }
  if (!res.ok || json?.success === false) {
    throw new OrgAdminError(errorMessage(json, res.status), res.status);
  }
}

/* ------------------------------- org settings ---------------------------- */

export interface OrgSetting {
  id: number;
  key: string;
  value: unknown;
  category: string;
}

export interface OrgSettingInput {
  key: string;
  value: unknown;
  category?: string;
}

export const orgSettingsApi = {
  list: () => configList<OrgSetting>('org-settings'),
  create: (input: OrgSettingInput) => configWrite<OrgSetting>(baseFor('org-settings'), 'POST', input),
  update: (id: number, input: Partial<OrgSettingInput>) =>
    configWrite<OrgSetting>(`${baseFor('org-settings')}${id}/`, 'PATCH', input),
  remove: (id: number) => configDelete(`${baseFor('org-settings')}${id}/`),
};

/* ------------------------------- code schemes ---------------------------- */

export interface CodeScheme {
  id: number;
  entityType: string;
  prefix: string;
  padding: number;
  nextSeq: number;
  separator: string;
  isActive: boolean;
  nextCodePreview: string;
}

export interface CodeSchemeInput {
  entity_type?: string;
  prefix?: string;
  padding?: number;
  next_seq?: number;
  separator?: string;
  is_active?: boolean;
}

export const codeSchemesApi = {
  list: () => configList<CodeScheme>('code-schemes'),
  create: (input: CodeSchemeInput & { entity_type: string }) =>
    configWrite<CodeScheme>(baseFor('code-schemes'), 'POST', input),
  update: (id: number, input: CodeSchemeInput) =>
    configWrite<CodeScheme>(`${baseFor('code-schemes')}${id}/`, 'PATCH', input),
  remove: (id: number) => configDelete(`${baseFor('code-schemes')}${id}/`),
  /** Issues the next code AND advances the counter (irreversible). */
  nextCode: (id: number) =>
    configWrite<{ code: string }>(`${baseFor('code-schemes')}${id}/next-code/`, 'POST', {}),
};

/* ------------------------------ hierarchy rules -------------------------- */

export interface HierarchyRule {
  id: number;
  fromLevel: number | null;
  fromLevelName: string | null;
  fromJobTitle: number | null;
  fromJobTitleName: string | null;
  mustReportToLevel: number | null;
  mustReportToLevelName: string | null;
  sameDepartment: boolean;
  active: boolean;
}

export interface HierarchyRuleInput {
  from_level?: number | null;
  from_job_title?: number | null;
  must_report_to_level?: number | null;
  same_department?: boolean;
  active?: boolean;
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
}

export const hierarchyRulesApi = {
  list: () => configList<HierarchyRule>('hierarchy-rules'),
  create: (input: HierarchyRuleInput) =>
    configWrite<HierarchyRule>(baseFor('hierarchy-rules'), 'POST', input),
  update: (id: number, input: HierarchyRuleInput) =>
    configWrite<HierarchyRule>(`${baseFor('hierarchy-rules')}${id}/`, 'PATCH', input),
  remove: (id: number) => configDelete(`${baseFor('hierarchy-rules')}${id}/`),
  /** Pre-checks a reporting line without saving anything. */
  validate: (employee_id: number | string, manager_id: number | string | null) =>
    configWrite<ValidateResult>(`${baseFor('hierarchy-rules')}validate/`, 'POST', {
      employee_id,
      manager_id,
    }),
};

export { OrgAdminError };
