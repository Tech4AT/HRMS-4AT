'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { managerChanges } from '@/lib/mock/org/phase2';
import type { ChangeRecord } from '@/lib/mock/org/phase2';
import { PageHeader, StatusPill, StubModal, type FieldDef } from '@/components/org-module/ui';

const fields: FieldDef[] = [
  { name: 'employee', label: 'Employee / team', placeholder: 'e.g. Rahul Verma' },
  { name: 'from', label: 'From (manager)', placeholder: 'e.g. Anita Desai' },
  { name: 'to', label: 'To (manager)', placeholder: 'e.g. Kiran Shah' },
  { name: 'effectiveDate', label: 'Effective date', placeholder: 'e.g. 2026-10-01' },
];

const STATUSES: ChangeRecord['status'][] = ['Completed', 'Pending', 'Scheduled'];

export default function ManagerChangesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return managerChanges.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (fromDate && c.effectiveDate < fromDate) return false;
      if (toDate && c.effectiveDate > toDate) return false;
      if (!q) return true;
      return [c.employee, c.from, c.to, c.changedBy].join(' ').toLowerCase().includes(q);
    });
  }, [search, statusFilter, fromDate, toDate]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Manager Changes"
          subtitle="Reporting-line changes with effective dates (mock data, stub actions)."
        />
        {canManage ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Log change
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
              placeholder="Search by employee, manager or changed-by…"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
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
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Effective from
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Effective to
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Manager Changes</h3>
          <span className="text-xs text-slate-500">
            Showing {visible.length} of {managerChanges.length}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">No records match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {[
                    'Employee / team',
                    'From',
                    'To',
                    'Effective date',
                    'Status',
                    'Changed by',
                    'Recorded (audit)',
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-slate-900">{c.employee}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.from}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.to}</td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.effectiveDate}</td>
                    <td className="px-5 py-3">
                      <StatusPill value={c.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{c.changedBy}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{c.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen ? (
        <StubModal title="Log manager change" fields={fields} onClose={() => setModalOpen(false)} />
      ) : null}
    </div>
  );
}
