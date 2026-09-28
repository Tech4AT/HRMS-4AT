'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { positions } from '@/lib/mock/org/phase2';
import type { Position } from '@/lib/mock/org/phase2';
import { PageHeader, StatusPill, StubModal, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'title', label: 'Title', placeholder: 'e.g. Software Engineer' },
  {
    name: 'department',
    label: 'Department',
    type: 'select',
    options: ['Engineering', 'Design', 'Consulting', 'Finance', 'People', 'Management'],
  },
  {
    name: 'level',
    label: 'Level',
    type: 'select',
    options: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'],
  },
  { name: 'reportsTo', label: 'Reports to', placeholder: 'e.g. Kiran Shah' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: ['Filled', 'Vacant', 'Hiring', 'On Hold'],
  },
];

const DEPARTMENTS = ['Engineering', 'Design', 'Consulting', 'Finance', 'People', 'Management'];
const STATUSES: Position['status'][] = ['Filled', 'Vacant', 'Hiring', 'On Hold'];

export default function PositionsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState<{ mode: 'add' | 'edit' | 'deactivate'; row?: Position } | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions.filter((p) => {
      if (deptFilter && p.department !== deptFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (!q) return true;
      return [p.positionId, p.title, p.department, p.level, p.reportsTo, p.incumbent]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [search, deptFilter, statusFilter]);

  const modalTitle =
    modal?.mode === 'add' ? 'Add position' : modal?.mode === 'edit' ? 'Edit position' : 'Set position inactive';

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Positions"
          subtitle="Every seat in the org — a position exists even when vacant (mock data, stub actions)."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => setModal({ mode: 'add' })}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Add position
          </button>
        ) : null}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Search
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by ID, title, incumbent…"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Department
            </label>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            >
              <option value="">All</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[150px]">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Positions</h3>
          <span className="text-xs text-slate-500">
            Showing {visible.length} of {positions.length}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No records match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Position ID', 'Title', 'Department', 'Level', 'Reports to', 'Status', 'Incumbent'].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                  {canManage ? (
                    <th className="px-5 py-3 text-right text-[11px] font-semibold text-slate-500 uppercase">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">{p.positionId}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{p.title}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{p.department}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{p.level}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{p.reportsTo}</td>
                    <td className="px-5 py-3">
                      <StatusPill value={p.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">
                      {p.incumbent || <span className="text-slate-400 italic">Vacant</span>}
                    </td>
                    {canManage ? (
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setModal({ mode: 'edit', row: p })}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setModal({ mode: 'deactivate', row: p })}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Set Inactive
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal ? (
        <StubModal
          title={modalTitle}
          fields={fields}
          initial={modal.row as unknown as Record<string, string> | undefined}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}
