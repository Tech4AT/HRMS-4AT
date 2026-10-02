'use client';

import { useMemo, useState } from 'react';
import {
  adminApi,
  ARCHETYPE_OPTIONS,
  REACH_OPTIONS,
  type Archetype,
  type Permission,
  type Role,
  type ScopeTier,
} from '@/lib/admin/api';
import { groupPermissions, permissionLabel } from '@/lib/admin/permissionGroups';
import { Button, Notice, Select, errorText } from './ui';

/**
 * Full-screen role builder (Keka-style "Create / Edit Role"): name +
 * description, a module sidebar, and that module's permissions as checkboxes
 * with a select-all. A single role-level "reach" applies to every permission
 * newly ticked here; each already-granted permission also gets its own reach
 * select (saved via PATCH role-permissions), so editing a role here never
 * clobbers tiers — it shows and updates them.
 */
export function RoleBuilder({
  role,
  permissions,
  onClose,
  onSaved,
}: {
  role: Role | null; // null = create
  permissions: Permission[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const groups = useMemo(() => groupPermissions(permissions), [permissions]);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [archetype, setArchetype] = useState<Archetype>(role?.archetype ?? 'employee');
  const [reach, setReach] = useState<ScopeTier>('all');
  const granted = useMemo(
    () => new Map((role?.permissions ?? []).map((g) => [g.permission, g.id])),
    [role],
  );
  // Per-permission reach for already-granted permissions, editable in place
  // (saved via PATCH role-permissions on Save). Mounted fresh per role (the
  // caller keys this component by role id), so initialising from props here
  // always reflects the latest server data.
  const [tiers, setTiers] = useState<Map<number, ScopeTier>>(
    () => new Map((role?.permissions ?? []).map((g) => [g.permission, g.scopeTier])),
  );
  const [checked, setChecked] = useState<Set<number>>(new Set(granted.keys()));
  const [activeGroup, setActiveGroup] = useState(groups[0]?.label ?? '');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visibleGroups = search.trim()
    ? groups
        .map((g) => ({
          ...g,
          perms: g.perms.filter((p) => {
            const hay = `${p.code} ${p.label ?? ''} ${p.description}`.toLowerCase();
            return hay.includes(search.toLowerCase());
          }),
        }))
        .filter((g) => g.perms.length)
    : groups.filter((g) => g.label === activeGroup);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const target = role ?? (await adminApi.createRole({ name: name.trim(), description, archetype }));
      if (role) {
        await adminApi.updateRole(role.id, { name: name.trim(), description, archetype });
      }
      // Diff: add newly-ticked permissions (at the chosen reach), remove
      // unticked ones, and PATCH the reach of still-ticked grants whose
      // per-permission reach changed. Already-granted-and-unchanged are left
      // untouched.
      const adds = [...checked].filter((id) => !granted.has(id));
      const removes = [...granted.entries()].filter(([id]) => !checked.has(id));
      for (const id of adds) await adminApi.addGrant(target.id, id, reach);
      for (const [, grantId] of removes) await adminApi.removeGrant(grantId);
      if (role) {
        const before = new Map(role.permissions.map((g) => [g.permission, g.scopeTier]));
        for (const [permId, grantId] of granted.entries()) {
          if (!checked.has(permId)) continue;
          const next = tiers.get(permId);
          if (next && before.get(permId) !== next) await adminApi.changeGrant(grantId, next);
        }
      }
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{role ? 'Edit role' : 'Create new role'}</h1>
        <div className="flex gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-6 max-w-6xl mx-auto space-y-6">
        {error && <Notice tone="error">{error}</Notice>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="block font-semibold text-gray-700 mb-1">Name of the role</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. HR Manager for South East Asia"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </label>
          <label className="text-sm">
            <span className="block font-semibold text-gray-700 mb-1">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this role is for"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </label>
          <label className="text-sm">
            <span className="block font-semibold text-gray-700 mb-1">App view</span>
            <Select value={archetype} onChange={(e) => setArchetype(e.target.value as Archetype)}>
              {ARCHETYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            <span className="block font-semibold text-gray-700 mb-1">
              Reach for newly-ticked permissions
            </span>
            <Select value={reach} onChange={(e) => setReach(e.target.value as ScopeTier)}>
              {REACH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Permissions</h2>
              <p className="text-sm text-gray-500">
                Tick the permissions this role should grant. {checked.size} selected.
                {role ? ' Each granted permission keeps its own reach, changeable here.' : ' Newly-ticked permissions use the reach chosen above.'}
              </p>
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search privileges…"
              className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-4">
            {/* Feature sidebar */}
            {!search.trim() && (
              <aside className="bg-white rounded-lg border border-gray-200 p-2 h-fit">
                {groups.map((g) => {
                  const sel = g.perms.filter((p) => checked.has(p.id)).length;
                  return (
                    <button
                      key={g.label}
                      onClick={() => setActiveGroup(g.label)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        g.label === activeGroup
                          ? 'bg-purple-100 text-purple-900 font-medium'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <div>{g.label}</div>
                      <div className="text-xs text-gray-500">
                        {sel > 0 ? `${sel} selected` : 'None selected'}
                      </div>
                    </button>
                  );
                })}
              </aside>
            )}

            {/* Privilege checkboxes */}
            <div className={`space-y-5 ${search.trim() ? 'lg:col-span-2' : ''}`}>
              {visibleGroups.map((g) => {
                const allOn = g.perms.every((p) => checked.has(p.id));
                return (
                  <div key={g.label} className="border border-gray-200 rounded-lg">
                    <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 font-semibold text-sm text-slate-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allOn}
                        onChange={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            const turnOn = !allOn;
                            for (const p of g.perms) turnOn ? next.add(p.id) : next.delete(p.id);
                            return next;
                          })
                        }
                      />
                      {g.label}
                    </label>
                    <div className="divide-y divide-gray-100">
                      {g.perms.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-start gap-2 px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked.has(p.id)}
                            onChange={() => toggle(p.id)}
                            className="mt-0.5"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-slate-900">
                              {permissionLabel(p)}{' '}
                              {p.description && (
                                <span
                                  title={p.description}
                                  aria-label={p.description}
                                  className="inline-flex items-center justify-center w-4 h-4 ml-1 text-[10px] font-bold text-gray-400 border border-gray-300 rounded-full cursor-help align-middle"
                                >
                                  i
                                </span>
                              )}
                            </span>
                            <span className="block text-xs text-gray-500 font-mono">{p.code}</span>
                          </span>
                          {granted.has(p.id) && checked.has(p.id) && (
                            <span className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Select
                                aria-label={`Reach for ${p.code}`}
                                value={tiers.get(p.id) ?? 'all'}
                                onChange={(e) =>
                                  setTiers((prev) => new Map(prev).set(p.id, e.target.value as ScopeTier))
                                }
                                className="!w-auto !py-1 !px-2 !text-xs"
                              >
                                {REACH_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value} title={o.hint}>
                                    {o.label}
                                  </option>
                                ))}
                              </Select>
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              {visibleGroups.length === 0 && (
                <p className="text-sm text-gray-500">No privileges match “{search}”.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
