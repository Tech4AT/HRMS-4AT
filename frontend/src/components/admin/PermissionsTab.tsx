'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adminApi,
  reachLabel,
  REACH_OPTIONS,
  type AdminUser,
  type Exception,
  type Permission,
  type Role,
  type ScopeTier,
} from '@/lib/admin/api';
import { Badge, Button, Notice, Select, SectionTitle } from './ui';
import { groupPermissions } from '@/lib/admin/permissionGroups';

export function PermissionsTab() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, r] = await Promise.all([adminApi.listPermissions(), adminApi.listRoles()]);
        setPermissions(p.results);
        setRoles(r.results);
        setSelectedId(p.results[0]?.id ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load permissions');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const groups = useMemo(() => groupPermissions(permissions), [permissions]);

  const selected = permissions.find((p) => p.id === selectedId) ?? null;

  if (loading) return <div className="text-gray-500">Loading permissions…</div>;
  if (error) return <Notice tone="error">{error}</Notice>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6">
      {/* Sidebar: modules → their permissions */}
      <aside className="bg-white rounded-lg border border-gray-200 p-3 h-fit lg:sticky lg:top-6">
        {groups.map((g) => (
          <div key={g.label} className="mb-4 last:mb-0">
            <div className="px-2 text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
              {g.label}
            </div>
            <div className="space-y-0.5">
              {g.perms.map((perm) => (
                <button
                  key={perm.id}
                  onClick={() => setSelectedId(perm.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                    perm.id === selectedId
                      ? 'bg-purple-100 text-purple-900 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {perm.code}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      {/* Detail: who holds the selected permission + add a person */}
      <section>
        {selected ? (
          <PermissionDetail permission={selected} roles={roles} />
        ) : (
          <div className="text-gray-500">No permissions found.</div>
        )}
      </section>
    </div>
  );
}

function PermissionDetail({ permission, roles }: { permission: Permission; roles: Role[] }) {
  const [people, setPeople] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const page = await adminApi.listExceptions({ permission: permission.id, pageSize: 100 });
      setPeople(page.results);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission.id]);

  // Roles that grant this permission (read-only context — role membership is
  // managed on the Roles and People tabs; this panel maps individuals).
  const grantingRoles = roles
    .filter((r) => r.permissions.some((g) => g.permission === permission.id))
    .map((r) => ({
      name: r.name,
      tier: r.permissions.find((g) => g.permission === permission.id)!.scopeTier,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{permission.code}</h2>
        {permission.description && <p className="text-gray-600 mt-1">{permission.description}</p>}
      </div>

      <div>
        <SectionTitle hint="Managed on the Roles and People tabs — shown here for context.">
          Roles that grant this
        </SectionTitle>
        {grantingRoles.length === 0 ? (
          <p className="text-sm text-gray-500">No role grants this permission.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {grantingRoles.map((r) => (
              <Badge key={r.name} tone="purple">
                {r.name} · {reachLabel(r.tier)}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle hint="Individuals mapped directly to this permission, on top of their role.">
          People mapped directly
        </SectionTitle>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : people.length === 0 ? (
          <p className="text-sm text-gray-500">No individual mappings yet.</p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {people.map((p) => (
              <PersonRow key={p.id} exception={p} onChanged={load} />
            ))}
          </div>
        )}
      </div>

      <AddPersonForm permission={permission} onAdded={load} />
    </div>
  );
}

function PersonRow({ exception, onChanged }: { exception: Exception; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await adminApi.removeException(exception.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900 truncate">{exception.userName}</div>
        <div className="text-xs text-gray-500 truncate">{exception.userEmail}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Badge tone={exception.isGranted ? 'green' : 'red'}>
          {exception.isGranted ? `Allow · ${reachLabel(exception.scopeTier)}` : 'Deny'}
        </Badge>
        <Button variant="danger" disabled={busy} onClick={remove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function AddPersonForm({ permission, onAdded }: { permission: Permission; onAdded: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AdminUser[]>([]);
  const [chosen, setChosen] = useState<AdminUser | null>(null);
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow');
  const [tier, setTier] = useState<ScopeTier>('self');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (chosen || search.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const page = await adminApi.listUsers({ search: search.trim(), pageSize: 8 });
        if (!cancelled) setResults(page.results);
      } catch {
        /* ignore search errors */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, chosen]);

  const submit = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.addException({
        user: chosen.id,
        permission: permission.id,
        scopeTier: effect === 'deny' ? 'self' : tier,
        isGranted: effect === 'allow',
      });
      setChosen(null);
      setSearch('');
      setEffect('allow');
      setTier('self');
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to map person');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
      <SectionTitle>Add a person to this permission</SectionTitle>
      {error && <Notice tone="error">{error}</Notice>}

      {chosen ? (
        <div className="flex items-center justify-between gap-3 mb-3 bg-white border border-gray-200 rounded px-3 py-2">
          <div className="text-sm">
            <span className="font-medium text-slate-900">
              {chosen.firstName} {chosen.lastName}
            </span>{' '}
            <span className="text-gray-500">{chosen.email}</span>
          </div>
          <button className="text-sm text-purple-600 hover:underline" onClick={() => setChosen(null)}>
            Change
          </button>
        </div>
      ) : (
        <div className="relative mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people by name or email…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow max-h-64 overflow-y-auto">
              {results.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    setChosen(u);
                    setResults([]);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
                >
                  <span className="font-medium">
                    {u.firstName} {u.lastName}
                  </span>{' '}
                  <span className="text-gray-500">{u.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Effect</span>
          <Select value={effect} onChange={(e) => setEffect(e.target.value as 'allow' | 'deny')}>
            <option value="allow">Allow</option>
            <option value="deny">Deny (block)</option>
          </Select>
        </label>
        {effect === 'allow' && (
          <label className="text-sm">
            <span className="block text-gray-600 mb-1">Reach</span>
            <Select value={tier} onChange={(e) => setTier(e.target.value as ScopeTier)}>
              {REACH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button onClick={submit} disabled={!chosen || busy}>
          {busy ? 'Adding…' : 'Add mapping'}
        </Button>
      </div>
    </div>
  );
}
