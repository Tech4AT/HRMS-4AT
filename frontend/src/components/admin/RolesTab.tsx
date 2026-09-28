'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminApi,
  type AdminUser,
  type Permission,
  type Role,
} from '@/lib/admin/api';
import { Badge, Button, ConfirmModal, Drawer, Notice, errorText } from './ui';
import { RoleBuilder } from './RoleBuilder';

// The seeded starter roles show an "Inbuilt" tag, like Keka's system roles.
const STARTER_ROLES = new Set(['Employee', 'Manager', 'HR Admin', 'Finance']);

const AVATAR_COLORS = [
  'bg-purple-200 text-purple-800',
  'bg-blue-200 text-blue-800',
  'bg-green-200 text-green-800',
  'bg-amber-200 text-amber-800',
  'bg-pink-200 text-pink-800',
  'bg-teal-200 text-teal-800',
];

function initials(u: AdminUser) {
  return `${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase() || u.email[0]?.toUpperCase() || '?';
}

// Coarse scope summary from the tiers of a role's grants.
function roleScope(role: Role): { head: string; sub: string; global: boolean } {
  if (role.permissions.length === 0) return { head: 'No access', sub: 'Nothing granted yet', global: false };
  const global = role.permissions.every((g) => g.scopeTier === 'all');
  return global
    ? { head: 'Global', sub: 'Across all employees', global: true }
    : { head: 'Scoped', sub: 'By team / department', global: false };
}

function UserChip({ user, color, onRemove }: { user: AdminUser; color: string; onRemove?: () => void }) {
  const name = `${user.firstName} ${user.lastName}`.trim() || user.email;
  return (
    <span className="inline-flex items-center gap-1.5 bg-gray-100 rounded-full pl-1 pr-2.5 py-0.5 text-xs text-gray-700 max-w-[12rem]">
      <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-semibold ${color}`}>
        {initials(user)}
      </span>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          aria-label={`Remove ${name} from role`}
          onClick={onRemove}
          className="text-gray-400 hover:text-red-600 font-bold leading-none"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menuId, setMenuId] = useState<number | null>(null);
  const [statusTarget, setStatusTarget] = useState<Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [opBusy, setOpBusy] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ role: Role | null } | null>(null);
  const [addUsersTarget, setAddUsersTarget] = useState<Role | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, p, u] = await Promise.all([
        adminApi.listRoles(),
        adminApi.listPermissions(),
        adminApi.listUsers({ pageSize: 500 }),
      ]);
      setRoles(r.results);
      setPermissions(p.results);
      setUsers(u.results);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const usersByRole = useMemo(() => {
    const map = new Map<number, AdminUser[]>();
    for (const u of users) {
      for (const r of u.roles) {
        (map.get(r.id) ?? map.set(r.id, []).get(r.id)!).push(u);
      }
    }
    return map;
  }, [users]);

  const total = permissions.length;
  const shown = roles.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()));

  const setActive = async (role: Role, isActive: boolean) => {
    setOpBusy(true);
    setOpError(null);
    try {
      await adminApi.updateRole(role.id, { isActive });
      setStatusTarget(null);
      await load();
    } catch (e) {
      setOpError(errorText(e));
    } finally {
      setOpBusy(false);
    }
  };

  const remove = async (role: Role) => {
    setOpBusy(true);
    setOpError(null);
    try {
      await adminApi.deleteRole(role.id);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setOpError(errorText(e));
    } finally {
      setOpBusy(false);
    }
  };

  const removeUserFromRole = async (role: Role, user: AdminUser) => {
    setOpBusy(true);
    setOpError(null);
    try {
      await adminApi.removeUsersFromRole(role.id, [user.id]);
      await load();
    } catch (e) {
      setOpError(errorText(e));
    } finally {
      setOpBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">User Roles</h2>
          <p className="text-sm text-gray-600 max-w-2xl mt-1">
            User roles can be assigned to employees from here. New roles can be created and privileges
            for all these roles can be managed from this section.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Roles"
            className="w-56 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <Button variant="primary" onClick={() => setBuilder({ role: null })}>
            + New Role
          </Button>
        </div>
      </div>

      {loading && <p className="text-gray-500 text-sm">Loading roles…</p>}
      {error && <Notice tone="error">{error}</Notice>}

      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-[1.6fr_0.9fr_1fr_2fr_auto] gap-4 px-5 py-3 bg-gray-50 text-xs font-bold uppercase tracking-wide text-gray-500">
            <div>User Roles</div>
            <div>Scope</div>
            <div>Permissions</div>
            <div>Users</div>
            <div>Actions</div>
          </div>
          {shown.map((role) => {
            const scope = roleScope(role);
            const fullAccess = total > 0 && role.permissions.length === total && scope.global;
            const roleUsers = usersByRole.get(role.id) ?? [];
            return (
              <div
                key={role.id}
                className="grid grid-cols-[1.6fr_0.9fr_1fr_2fr_auto] gap-4 px-5 py-4 border-t border-gray-100 items-start"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {STARTER_ROLES.has(role.name) && <Badge tone="purple">Inbuilt</Badge>}
                    {!role.isActive && <Badge tone="red">Inactive</Badge>}
                  </div>
                  <div className="font-semibold text-slate-900">{role.name}</div>
                  {role.description && <p className="text-sm text-gray-500 mt-0.5">{role.description}</p>}
                </div>

                <div className="text-sm">
                  <div className="font-semibold text-slate-900">{scope.head}</div>
                  <div className="text-gray-500">{scope.sub}</div>
                </div>

                <div className="text-sm">
                  <Badge tone={fullAccess ? 'green' : 'gray'}>{fullAccess ? 'Full Access' : 'Limited'}</Badge>
                  <button
                    onClick={() => setBuilder({ role })}
                    className="mt-1.5 block text-purple-600 hover:underline"
                  >
                    {role.permissions.length} / {total} · View
                  </button>
                </div>

                <div>
                  <div className="text-sm text-gray-600 mb-1.5">Added users ({roleUsers.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {roleUsers.slice(0, 5).map((u, i) => (
                      <UserChip
                        key={u.id}
                        user={u}
                        color={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                        onRemove={() => removeUserFromRole(role, u)}
                      />
                    ))}
                    {roleUsers.length > 5 && (
                      <span className="text-xs text-gray-500 self-center">+{roleUsers.length - 5} more</span>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <Button
                    aria-label={`Actions for ${role.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuId === role.id}
                    onClick={() => setMenuId(menuId === role.id ? null : role.id)}
                  >
                    ⋮
                  </Button>
                  {menuId === role.id && (
                    <>
                      <button
                        aria-label="Close menu"
                        className="fixed inset-0 z-10 cursor-default"
                        onClick={() => setMenuId(null)}
                        onKeyDown={(e) => e.key === 'Escape' && setMenuId(null)}
                      />
                      <div
                        role="menu"
                        className="absolute right-0 z-20 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1"
                      >
                        <button
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setMenuId(null);
                            setBuilder({ role });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setMenuId(null);
                            setOpError(null);
                            setAddUsersTarget(role);
                          }}
                        >
                          Add users
                        </button>
                        <button
                          role="menuitem"
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            setMenuId(null);
                            if (role.isActive && role.userCount > 0) {
                              setOpError(null);
                              setStatusTarget(role);
                            } else {
                              setActive(role, !role.isActive);
                            }
                          }}
                        >
                          {role.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {!STARTER_ROLES.has(role.name) && (
                          <button
                            role="menuitem"
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                            onClick={() => {
                              setMenuId(null);
                              setOpError(null);
                              setDeleteTarget(role);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <p className="px-5 py-6 text-center text-gray-500 text-sm">No roles found.</p>}
        </div>
      )}

      {builder && (
        <RoleBuilder
          key={builder.role?.id ?? 'new'}
          role={builder.role}
          permissions={permissions}
          onClose={() => setBuilder(null)}
          onSaved={async () => {
            setBuilder(null);
            await load();
          }}
        />
      )}

      {statusTarget && (
        <ConfirmModal
          title={`Deactivate “${statusTarget.name}”?`}
          body={
            <p>
              {statusTarget.userCount} {statusTarget.userCount === 1 ? 'person holds' : 'people hold'} this role. They will lose everything it grants immediately, even if they are signed in.
              You can reactivate it at any time.
            </p>
          }
          confirmLabel="Deactivate"
          danger
          busy={opBusy}
          error={opError}
          onConfirm={() => setActive(statusTarget, false)}
          onCancel={() => {
            setStatusTarget(null);
            setOpError(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete “${deleteTarget.name}”?`}
          body={<p>This permanently removes the role and its permission settings. It cannot be undone.</p>}
          confirmLabel="Delete role"
          danger
          busy={opBusy}
          error={opError}
          onConfirm={() => remove(deleteTarget)}
          onCancel={() => {
            setDeleteTarget(null);
            setOpError(null);
          }}
        />
      )}

      {addUsersTarget && (
        <AddUsersPanel
          role={addUsersTarget}
          users={users}
          onClose={() => setAddUsersTarget(null)}
          onSaved={async () => {
            setAddUsersTarget(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AddUsersPanel({
  role,
  users,
  onClose,
  onSaved,
}: {
  role: Role;
  users: AdminUser[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberIds = useMemo(
    () =>
      new Set(
        users.filter((u) => u.roles.some((r) => r.id === role.id)).map((u) => u.id),
      ),
    [users, role.id],
  );
  const candidates = users.filter(
    (u) =>
      !memberIds.has(u.id) &&
      (`${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const save = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.addUsersToRole(role.id, selected);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Drawer title={`Add users — ${role.name}`} subtitle={`${memberIds.size} already hold this role`} onClose={onClose}>
      <div className="space-y-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people by name or email…"
          aria-label="Search people"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="space-y-1.5 max-h-80 overflow-y-auto border border-gray-200 rounded-lg p-2">
          {candidates.map((u) => (
            <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={selected.includes(u.id)}
                onChange={() => toggle(u.id)}
                aria-label={`${u.firstName} ${u.lastName}`.trim() || u.email}
              />
              <span className="text-gray-900">
                {`${u.firstName} ${u.lastName}`.trim() || u.email}
              </span>
              <span className="text-xs text-gray-400 truncate">{u.email}</span>
            </label>
          ))}
          {candidates.length === 0 && (
            <p className="text-sm text-gray-500 px-2 py-1">Everyone is already in this role.</p>
          )}
        </div>
        <Button variant="primary" disabled={busy || selected.length === 0} onClick={save}>
          {busy ? 'Adding…' : `Add ${selected.length === 0 ? '' : `${selected.length} `}user${selected.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Drawer>
  );
}

