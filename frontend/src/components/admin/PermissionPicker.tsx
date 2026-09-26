'use client';

import { useMemo, useState } from 'react';
import type { Permission } from '@/lib/admin/api';
import { groupPermissions, permissionLabel } from '@/lib/admin/permissionGroups';
import { Select } from './ui';

/**
 * Single-permission picker: a search box filtering a grouped dropdown
 * (one <optgroup> per feature area, short label per row). The single-select
 * analogue of RoleBuilder's grouped privilege list — used wherever one
 * permission must be chosen (personal exceptions, access preview).
 */
export function PermissionPicker({
  permissions,
  value,
  onChange,
  label,
  valueKey = 'id',
  placeholder = 'Choose a permission…',
}: {
  permissions: Permission[];
  value: number | string | '';
  onChange: (value: number | '' | string) => void;
  label: string;
  /** 'id' (exceptions) or 'code' (access preview) — what the option values are. */
  valueKey?: 'id' | 'code';
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? permissions.filter((p) =>
          `${p.code} ${p.label ?? ''} ${p.description}`.toLowerCase().includes(q),
        )
      : permissions;
    return groupPermissions(list);
  }, [permissions, search]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search privileges…"
        aria-label="Search privileges"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
      <Select
        aria-label={label}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') return onChange('');
          onChange(valueKey === 'code' ? v : Number(v));
        }}
      >
        <option value="">{placeholder}</option>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.perms.map((p) => (
              <option key={p.id} value={valueKey === 'code' ? p.code : p.id}>
                {permissionLabel(p)}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {search.trim() && groups.length === 0 && (
        <p className="text-sm text-gray-500">No privileges match “{search}”.</p>
      )}
    </div>
  );
}
