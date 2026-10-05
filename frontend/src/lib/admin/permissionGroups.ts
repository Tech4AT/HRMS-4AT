import type { Permission } from './api';

// Permissions are grouped by the backend `group` field, synced from each
// module's `rbac.py` (authoritative — not guessed from the code prefix). A
// permission with no group (legacy rows not yet re-synced) falls back to the
// prefix guess, so a brand-new module's permissions still group automatically.
const PREFIX_LABELS: Record<string, string> = {
  employees: 'Employee data',
  ess: 'Self-service (own profile)',
  example_leave: 'Leaves & attendance',
  leave: 'Leaves & attendance',
  attendance: 'Leaves & attendance',
  payroll: 'Payroll',
  org: 'Organisation',
  roles: 'Access control',
  audit: 'Audit & activity',
};

export function groupKey(code: string): string {
  return code.split('.')[0];
}

export function groupLabel(key: string): string {
  return PREFIX_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/, (c) => c.toUpperCase());
}

/** The group a permission is listed under: backend first, prefix fallback. */
export function permissionGroup(perm: Permission): string {
  return perm.group?.trim() || groupLabel(groupKey(perm.code));
}

/** Short row text: backend label, then description, then the code itself. */
export function permissionLabel(perm: Permission): string {
  return perm.label?.trim() || perm.description || perm.code;
}

/** Permissions bucketed by group, each list sorted by code, groups by label. */
export function groupPermissions(
  permissions: Permission[],
): { label: string; perms: Permission[] }[] {
  const byGroup = new Map<string, Permission[]>();
  for (const perm of permissions) {
    const label = permissionGroup(perm);
    (byGroup.get(label) ?? byGroup.set(label, []).get(label)!).push(perm);
  }
  return [...byGroup.entries()]
    .map(([label, perms]) => ({ label, perms: perms.sort((a, b) => a.code.localeCompare(b.code)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
