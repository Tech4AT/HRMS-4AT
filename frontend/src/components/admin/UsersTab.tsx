'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import {
  adminApi,
  REACH_OPTIONS,
  reachLabel,
  type AccessPreview,
  type AdminUser,
  type Exception,
  type Page,
  type Permission,
  type Role,
  type ScopeTier,
} from '@/lib/admin/api';
import { Button, ConfirmModal, Drawer, Notice, Pager, SectionTitle, Select, errorText } from './ui';
import { PermissionPicker } from './PermissionPicker';

const PAGE_SIZE = 20;

const AVATAR_COLORS = [
  'bg-purple-200 text-purple-800',
  'bg-blue-200 text-blue-800',
  'bg-green-200 text-green-800',
  'bg-amber-200 text-amber-800',
  'bg-pink-200 text-pink-800',
  'bg-teal-200 text-teal-800',
];

function initialsOf(u: AdminUser) {
  return `${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase() || u.email[0]?.toUpperCase() || '?';
}

function displayName(u: AdminUser) {
  return `${u.firstName} ${u.lastName}`.trim() || u.email;
}

export function UsersTab() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminUser> | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [exceptionsId, setExceptionsId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    Promise.all([adminApi.listRoles(), adminApi.listPermissions()])
      .then(([r, p]) => {
        setRoles(r.results);
        setPermissions(p.results);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await adminApi.listUsers({ search: debounced, page, pageSize: PAGE_SIZE }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [debounced, page]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = data?.results.find((u) => u.id === selectedId) ?? null;
  const exceptionsUser = data?.results.find((u) => u.id === exceptionsId) ?? null;

  // Permission counts come straight from the backend (`permissionCount` =
  // the user's true effective set: union across active roles + overrides +
  // baseline − denies), so a multi-role user's count always matches the
  // backend instead of guessing from one role's grants.
  const totalPermissions = permissions.length;

  const replaceUser = (updated: AdminUser) =>
    setData((d) => (d ? { ...d, results: d.results.map((u) => (u.id === updated.id ? updated : u)) } : d));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Users</h2>
          <p className="text-sm text-gray-600 max-w-2xl mt-1">
            Everyone with access. Change a person&apos;s roles or manage their personal
            exceptions from the Actions menu on their row.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or employee number"
          aria-label="Search users"
          className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <p className="text-sm text-gray-500">Loading users…</p>}

      {data && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[40rem]">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Users</th>
                <th className="px-4 py-3 font-semibold">Roles</th>
                <th className="px-4 py-3 font-semibold">Permissions</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((u, i) => {
                const roleNames = u.roles.map((r) => r.name);
                return (
                  <tr key={u.id} className="border-t border-gray-100 hover:bg-purple-50">
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-3 text-left" onClick={() => setSelectedId(u.id)}>
                        <span
                          aria-hidden="true"
                          className={`w-9 h-9 rounded-full grid place-items-center text-xs font-bold shrink-0 ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                        >
                          {initialsOf(u)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-gray-900 truncate hover:underline">
                            {displayName(u)}
                          </span>
                          <span className="block text-xs text-gray-500 truncate">
                            {u.employeeCode ?? u.email}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{roleNames.length ? roleNames.join(', ') : <span className="text-gray-400">No roles</span>}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {u.permissionCount} / {totalPermissions}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <Button
                          aria-label={`Actions for ${displayName(u)}`}
                          aria-haspopup="menu"
                          aria-expanded={menuId === u.id}
                          onClick={() => setMenuId(menuId === u.id ? null : u.id)}
                        >
                          ⋮
                        </Button>
                        {menuId === u.id && (
                          <>
                            <button
                              aria-label="Close menu"
                              className="fixed inset-0 z-10 cursor-default"
                              onClick={() => setMenuId(null)}
                              onKeyDown={(e) => e.key === 'Escape' && setMenuId(null)}
                            />
                            <div
                              role="menu"
                              className="absolute right-0 z-20 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1"
                            >
                              <button
                                role="menuitem"
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                onClick={() => {
                                  setMenuId(null);
                                  setSelectedId(u.id);
                                }}
                              >
                                Change roles
                              </button>
                              <button
                                role="menuitem"
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                onClick={() => {
                                  setMenuId(null);
                                  setExceptionsId(u.id);
                                }}
                              >
                                Manage exceptions
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data.results.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    No one matches “{debounced}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      <p className="text-xs text-gray-500 mt-3">
        Permission counts show what each person effectively holds across all their roles;
        personal exceptions can add or remove individual permissions on top.
      </p>

      {selected && (
        <PersonPanel
          key={selected.id}
          person={selected}
          roles={roles}
          permissions={permissions}
          onChanged={replaceUser}
          onClose={() => setSelectedId(null)}
        />
      )}

      {exceptionsUser && (
        <Drawer
          title={`Exceptions — ${displayName(exceptionsUser)}`}
          subtitle={exceptionsUser.email}
          onClose={() => setExceptionsId(null)}
        >
          <ExceptionsSection person={exceptionsUser} permissions={permissions} onChanged={() => {}} />
        </Drawer>
      )}
    </div>
  );
}

type Action = 'deactivate' | 'reactivate' | 'reset' | 'signout' | 'role';

function PersonPanel({
  person,
  roles,
  permissions,
  onChanged,
  onClose,
}: {
  person: AdminUser;
  roles: Role[];
  permissions: Permission[];
  onChanged: (u: AdminUser) => void;
  onClose: () => void;
}) {
  const { user: me } = useAuth();
  const isMe = me?.email.toLowerCase() === person.email.toLowerCase();
  const name = `${person.firstName} ${person.lastName}`.trim() || person.email;

  const [roleIds, setRoleIds] = useState<number[]>(person.roles.map((r) => r.id));
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to refresh the reach preview

  const currentIds = useMemo(() => person.roles.map((r) => r.id).sort((a, b) => a - b), [person]);
  const chosenIds = useMemo(() => [...roleIds].sort((a, b) => a - b), [roleIds]);
  const rolesChanged =
    chosenIds.length !== currentIds.length || chosenIds.some((id, i) => id !== currentIds[i]);

  const toggleRole = (id: number) =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setConfirm(null);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setConfirm(null);
    setActionError(null);
  };

  return (
    <Drawer title={name} subtitle={person.email} onClose={onClose}>
      <section className="space-y-3">
        <SectionTitle>Roles</SectionTitle>
        <div className="space-y-1.5 max-h-56 overflow-y-auto border border-gray-200 rounded-lg p-2">
          {roles.map((r) => (
            <label
              key={r.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-gray-50 ${isMe ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                checked={roleIds.includes(r.id)}
                onChange={() => toggleRole(r.id)}
                disabled={isMe}
                aria-label={r.name}
              />
              <span className="text-gray-900">
                {r.name}
                {r.isActive ? '' : ' (inactive)'}
              </span>
            </label>
          ))}
          {roles.length === 0 && <p className="text-sm text-gray-500 px-2 py-1">No roles yet.</p>}
        </div>
        {isMe && <p className="text-xs text-gray-500">You cannot change your own roles. Ask another administrator.</p>}
        <Button variant="primary" disabled={isMe || busy || !rolesChanged} onClick={() => setConfirm('role')}>
          Change roles
        </Button>
        {message && <Notice tone="success">{message}</Notice>}
      </section>

      <section className="space-y-3">
        <SectionTitle hint={person.isActive ? 'This account can sign in.' : 'This account is deactivated and cannot sign in.'}>Account</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {person.isActive ? (
            <Button variant="danger" disabled={isMe} onClick={() => setConfirm('deactivate')}>
              Deactivate account
            </Button>
          ) : (
            <Button onClick={() => setConfirm('reactivate')}>Reactivate account</Button>
          )}
          <Button onClick={() => setConfirm('reset')}>Reset password</Button>
          <Button onClick={() => setConfirm('signout')}>Sign out everywhere</Button>
        </div>
        {isMe && <p className="text-xs text-gray-500">You cannot deactivate your own account.</p>}
        {tempPassword && (
          <Notice tone="warning">
            <p className="font-semibold">Temporary password (shown once)</p>
            <p className="font-mono text-base my-1 select-all">{tempPassword}</p>
            <p className="text-xs">Give this to {name} directly. It is not stored anywhere you can look it up again, and they should change it after signing in.</p>
            <button className="text-xs font-semibold underline mt-1" onClick={() => navigator.clipboard?.writeText(tempPassword)}>
              Copy
            </button>
          </Notice>
        )}
      </section>

      <ExceptionsSection person={person} permissions={permissions} onChanged={() => setVersion((v) => v + 1)} />
      <PreviewSection person={person} permissions={permissions} version={version} />

      {confirm === 'role' && (
        <ConfirmModal
          title={`Change ${name}'s roles?`}
          body={
            <p>
              From <strong>{person.roles.map((r) => r.name).join(', ') || 'no roles'}</strong> to{' '}
              <strong>
                {roles
                  .filter((r) => chosenIds.includes(r.id))
                  .map((r) => r.name)
                  .join(', ') || 'no roles'}
              </strong>
              . What they can do changes immediately, even if they are signed in.
            </p>
          }
          confirmLabel="Change roles"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              const updated = await adminApi.updateUser(person.id, { roleIds: chosenIds });
              onChanged(updated);
              setRoleIds(updated.roles.map((r) => r.id));
              setMessage(
                `Roles updated (${chosenIds.length === 0 ? 'no roles' : `${chosenIds.length} role${chosenIds.length === 1 ? '' : 's'}`}).`,
              );
              setVersion((v) => v + 1);
            })
          }
        />
      )}
      {confirm === 'deactivate' && (
        <ConfirmModal
          title={`Deactivate ${name}?`}
          body={<p>They will be signed out at once and will not be able to sign in until you reactivate the account.</p>}
          confirmLabel="Deactivate"
          danger
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              onChanged(await adminApi.updateUser(person.id, { isActive: false }));
              setMessage('Account deactivated.');
            })
          }
        />
      )}
      {confirm === 'reactivate' && (
        <ConfirmModal
          title={`Reactivate ${name}?`}
          body={<p>They will be able to sign in again with their current password.</p>}
          confirmLabel="Reactivate"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              onChanged(await adminApi.updateUser(person.id, { isActive: true }));
              setMessage('Account reactivated.');
            })
          }
        />
      )}
      {confirm === 'reset' && (
        <ConfirmModal
          title={`Reset ${name}'s password?`}
          body={<p>Their current password stops working. You will be shown a temporary password once, to pass on to them.</p>}
          confirmLabel="Reset password"
          danger
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              const r = await adminApi.resetPassword(person.id);
              setTempPassword(r.temporaryPassword);
            })
          }
        />
      )}
      {confirm === 'signout' && (
        <ConfirmModal
          title={`Sign ${name} out everywhere?`}
          body={<p>Every device they are signed in on will be signed out. They can sign in again with their password.</p>}
          confirmLabel="Sign out"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              const r = await adminApi.revokeSessions(person.id);
              setMessage(`Signed out of ${r.revokedCount} ${r.revokedCount === 1 ? 'session' : 'sessions'}.`);
            })
          }
        />
      )}
    </Drawer>
  );
}

export function ExceptionsSection({ person, permissions, onChanged }: { person: AdminUser; permissions: Permission[]; onChanged: () => void }) {
  const [items, setItems] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionId, setPermissionId] = useState<number | ''>('');
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [tier, setTier] = useState<ScopeTier>('self');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await adminApi.listExceptions({ user: person.id, pageSize: 100 })).results);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [person.id]);

  useEffect(() => {
    load();
  }, [load]);

  const available = permissions.filter((p) => !items.some((i) => i.permission === p.id));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <SectionTitle hint="An exception applies to this person only and always wins over their role. A denial removes the permission even if their role grants it.">
        Personal exceptions
      </SectionTitle>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {!loading && items.length === 0 && <p className="text-sm text-gray-500">None. This person has exactly what their roles give them.</p>}
      {items.length > 0 && (
        <ul className="border border-gray-200 rounded-xl divide-y divide-gray-100">
          {items.map((i) => (
            <li key={i.id} className="p-3 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-mono text-xs text-gray-500">{i.permissionCode}</p>
                <p className="text-gray-900">{i.isGranted ? <>Allowed — {reachLabel(i.scopeTier).toLowerCase()}</> : <span className="text-red-700 font-semibold">Denied</span>}</p>
              </div>
              <Button variant="danger" disabled={busy} onClick={() => act(() => adminApi.removeException(i.id))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="border border-dashed border-gray-300 rounded-xl p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Add an exception</p>
          <PermissionPicker
            permissions={available}
            value={permissionId}
            onChange={(v) => setPermissionId(v as number | '')}
            label="Permission"
          />
          <div className="flex gap-2">
            <Select aria-label="Effect" value={effect} onChange={(e) => setEffect(e.target.value as 'allow' | 'deny')}>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </Select>
            {effect === 'allow' && (
              <Select aria-label="Reach" value={tier} onChange={(e) => setTier(e.target.value as ScopeTier)}>
                {REACH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <Button
            variant="primary"
            disabled={busy || permissionId === ''}
            onClick={() =>
              act(async () => {
                await adminApi.addException({ user: person.id, permission: Number(permissionId), scopeTier: effect === 'deny' ? 'self' : tier, isGranted: effect === 'allow' });
                setPermissionId('');
              })
            }
          >
            Add exception
          </Button>
        </div>
      )}
    </section>
  );
}

const SOURCE_TEXT: Record<string, string> = {
  role: 'their roles',
  override: 'a personal exception',
  'baseline (employee)': 'their standard employee access',
};

const NO_ACCESS_TEXT: Record<string, string> = {
  none: 'their role does not grant it and they have no personal exception',
  'role (inactive)': 'their role is inactive',
  'override (deny)': 'a personal exception denies it',
};

function PreviewSection({ person, permissions, version }: { person: AdminUser; permissions: Permission[]; version: number }) {
  const initial = permissions.find((p) => p.code === 'employees.read')?.code ?? permissions[0]?.code ?? '';
  const [code, setCode] = useState(initial);
  const [preview, setPreview] = useState<AccessPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code && initial) setCode(initial);
  }, [code, initial]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    adminApi
      .accessPreview(person.id, code)
      .then((p) => {
        if (!cancelled) {
          setPreview(p);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [person.id, code, version]);

  return (
    <section className="space-y-3">
      <SectionTitle hint="The result of the rules as they stand right now, using the same logic the system enforces.">What can this person reach?</SectionTitle>
      <PermissionPicker
        permissions={permissions}
        value={code}
        onChange={(v) => setCode(v as string)}
        label="Permission to preview"
        valueKey="code"
      />
      {error && <Notice tone="error">{error}</Notice>}
      {preview && (
        <div className="space-y-2">
          {preview.granted ? (
            <Notice tone="info">
              Can reach <strong>{preview.reachCount}</strong> of {preview.totalEmployees} {preview.totalEmployees === 1 ? 'person' : 'people'}: {reachLabel(preview.tier).toLowerCase()}, from{' '}
              {SOURCE_TEXT[preview.source] ?? preview.source}.
            </Notice>
          ) : (
            <Notice tone="warning">No access, because {NO_ACCESS_TEXT[preview.source] ?? preview.source}.</Notice>
          )}
          {preview.people.length > 0 && (
            <ul className="max-h-56 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100 text-sm">
              {preview.people.map((p) => (
                <li key={p.id} className="px-3 py-2 flex justify-between gap-2">
                  <span className="text-gray-900">{p.name}</span>
                  <span className="text-xs text-gray-400">{p.employeeCode}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.truncated && <p className="text-xs text-gray-500">Showing the first {preview.people.length}.</p>}
        </div>
      )}
    </section>
  );
}
