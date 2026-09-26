'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { Badge, Button, ConfirmModal, Drawer, Notice, Pager, SectionTitle, Select, errorText } from './ui';
import { PermissionPicker } from './PermissionPicker';

const PAGE_SIZE = 20;

export function PeopleTab() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminUser> | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

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

  const replaceUser = (updated: AdminUser) =>
    setData((d) => (d ? { ...d, results: d.results.map((u) => (u.id === updated.id ? updated : u)) } : d));

  return (
    <div>
      <p className="text-sm text-gray-600 max-w-2xl mb-4">
        Find a person to change their role, manage their account, give or take away a specific permission, or check exactly what they can reach.
      </p>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        aria-label="Search people"
        className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg mb-4"
      />

      {error && <Notice tone="error">{error}</Notice>}
      {loading && !data && <p className="text-sm text-gray-500">Loading people…</p>}

      {data && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Person</th>
                <th className="px-4 py-3 font-semibold hidden md:table-cell">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Account</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((u) => (
                <tr key={u.id} onClick={() => setSelectedId(u.id)} className="border-t border-gray-100 hover:bg-purple-50 cursor-pointer">
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    <button className="text-left hover:underline" onClick={() => setSelectedId(u.id)}>
                      {`${u.firstName} ${u.lastName}`.trim() || u.email}
                    </button>
                    {u.employeeCode && <span className="ml-2 text-xs text-gray-400 font-normal">{u.employeeCode}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{u.email}</td>
                  <td className="px-4 py-3 text-gray-700">{u.roleName ?? <span className="text-gray-400">No role</span>}</td>
                  <td className="px-4 py-3">{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</td>
                </tr>
              ))}
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

  const [roleId, setRoleId] = useState<number | ''>(person.role ?? '');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to refresh the reach preview

  const chosenRole = roles.find((r) => r.id === roleId);

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
        <SectionTitle>Role</SectionTitle>
        <Select
          aria-label="Role"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value ? Number(e.target.value) : '')}
          disabled={isMe}
        >
          {person.role === null && <option value="">No role</option>}
          {roles
            .filter((r) => r.isActive || r.id === person.role)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isActive ? '' : ' (inactive)'}
              </option>
            ))}
        </Select>
        {isMe && <p className="text-xs text-gray-500">You cannot change your own role. Ask another administrator.</p>}
        <Button variant="primary" disabled={isMe || busy || roleId === '' || roleId === person.role} onClick={() => setConfirm('role')}>
          Change role
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

      {confirm === 'role' && chosenRole && (
        <ConfirmModal
          title={`Change ${name}'s role?`}
          body={
            <p>
              From <strong>{person.roleName ?? 'no role'}</strong> to <strong>{chosenRole.name}</strong>. What they can do changes immediately, even if they are signed in.
            </p>
          }
          confirmLabel="Change role"
          busy={busy}
          error={actionError}
          onCancel={close}
          onConfirm={() =>
            run(async () => {
              onChanged(await adminApi.updateUser(person.id, { role: chosenRole.id }));
              setMessage(`Role changed to ${chosenRole.name}.`);
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

function ExceptionsSection({ person, permissions, onChanged }: { person: AdminUser; permissions: Permission[]; onChanged: () => void }) {
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
      {!loading && items.length === 0 && <p className="text-sm text-gray-500">None. This person has exactly what their role gives them.</p>}
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
  role: 'their role',
  override: 'a personal exception',
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
