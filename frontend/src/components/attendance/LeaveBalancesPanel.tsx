'use client';

import { useEffect, useState } from 'react';
import { formatDays, type LeaveType } from '@/lib/api/leave';
import {
  leaveBalanceAdminApi,
  LeaveBalanceAdminApiError,
  type LeaveBalanceAdminEmployee,
} from '@/lib/api/leaveBalanceAdmin';

const ALL = 'All';

/** Settings > Leave Settings > Leave Balances. Real data now: every active
 *  employee's balance for the current financial year, lazily seeded server-side
 *  (PLAN.md Step 7) via `leaveBalanceAdminApi`. HR edits one employee's `used`
 *  days per leave type at a time through the same modal this always had; the
 *  edit is now a real, audited correction (`LeaveBalance.admin_adjusted`), not
 *  local-only state that resets on refresh. `types` still comes from the
 *  parent (`LeaveSettingsPanel`, already loading real leave types) for the
 *  table's column set - matched against each employee's own `balances` by
 *  `leaveTypeId`. */
export function LeaveBalancesPanel({ types }: { types: LeaveType[] }) {
  const [employees, setEmployees] = useState<LeaveBalanceAdminEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [businessUnit, setBusinessUnit] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [search, setSearch] = useState('');

  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setLoadError(null);
    leaveBalanceAdminApi
      .list()
      .then((data) => setEmployees(data.employees))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load leave balances'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const nonEmpty = (values: (string | null)[]) =>
    Array.from(new Set(values.filter((v): v is string => Boolean(v))));

  const businessUnits = [ALL, ...nonEmpty(employees.map((e) => e.businessUnit))];
  const departments = [ALL, ...nonEmpty(employees.map((e) => e.department))];
  const locations = [ALL, ...nonEmpty(employees.map((e) => e.location))];

  const filtered = employees.filter(
    (e) =>
      (businessUnit === ALL || e.businessUnit === businessUnit) &&
      (department === ALL || e.department === department) &&
      (location === ALL || e.location === location) &&
      (e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.employeeCode.toLowerCase().includes(search.toLowerCase())),
  );

  const balanceFor = (employee: LeaveBalanceAdminEmployee, type: LeaveType) =>
    employee.balances.find((b) => b.leaveTypeId === type.id);

  const startEdit = (employee: LeaveBalanceAdminEmployee) => {
    const current: Record<string, number> = {};
    types.forEach((t) => {
      current[t.id] = balanceFor(employee, t)?.used ?? 0;
    });
    setDraft(current);
    setSaveError(null);
    setEditingEmployeeId(employee.id);
  };

  const saveEdit = async () => {
    if (!editingEmployeeId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await leaveBalanceAdminApi.updateEmployeeBalances(
        editingEmployeeId,
        types.map((t) => ({ leaveTypeId: t.id, used: draft[t.id] ?? 0 })),
      );
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditingEmployeeId(null);
    } catch (e) {
      setSaveError(e instanceof LeaveBalanceAdminApiError ? e.message : 'Could not save this balance');
    } finally {
      setSaving(false);
    }
  };

  const editingEmployee = employees.find((e) => e.id === editingEmployeeId);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5">
        <h3 className="text-base font-bold text-slate-900">Leave balances</h3>
        <p className="text-xs text-slate-500 mt-1">View and configure leave balances of all employees.</p>
      </div>

      <div className="flex flex-wrap gap-3 px-5 pb-4">
        <select
          value={businessUnit}
          onChange={(e) => setBusinessUnit(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
        >
          {businessUnits.map((v) => (
            <option key={v}>{v === ALL ? 'Business Unit' : v}</option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
        >
          {departments.map((v) => (
            <option key={v}>{v === ALL ? 'Department' : v}</option>
          ))}
        </select>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
        >
          {locations.map((v) => (
            <option key={v}>{v === ALL ? 'Location' : v}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          className="flex-1 min-w-[160px] text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
        />
      </div>

      {loading ? (
        <p className="px-5 pb-5 text-sm text-slate-500">Loading leave balances…</p>
      ) : loadError ? (
        <p className="px-5 pb-5 text-sm text-red-600">{loadError}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-y border-slate-200">
              <tr>
                {['Employee Name', 'Employee Number', 'Business Unit', 'Department', 'Location', ...types.map((t) => t.name), 'Actions'].map(
                  (h) => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium text-slate-900 whitespace-nowrap">{emp.name}</td>
                  <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.employeeCode}</td>
                  <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.businessUnit ?? '—'}</td>
                  <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.department ?? '—'}</td>
                  <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.location ?? '—'}</td>
                  {types.map((t) => {
                    const balance = balanceFor(emp, t);
                    return (
                      <td key={t.id} className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">
                        {balance ? `${formatDays(balance.used)}/${formatDays(balance.entitled)} days` : '—'}
                      </td>
                    );
                  })}
                  <td className="px-5 py-4 text-sm whitespace-nowrap">
                    <button onClick={() => startEdit(emp)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5 + types.length + 1} className="px-5 py-10 text-center text-sm text-slate-400">
                    No employees match your filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {editingEmployeeId && editingEmployee ? (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setEditingEmployeeId(null)}
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">{editingEmployee.name} — Leave balances</h3>
              <button
                onClick={() => setEditingEmployeeId(null)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              {types.map((t) => {
                const entitled = balanceFor(editingEmployee, t)?.entitled ?? t.annual_allocation;
                return (
                  <div key={t.id} className="flex items-center justify-between gap-3">
                    <label className="text-sm text-slate-700">{t.name}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={entitled}
                        step={0.5}
                        value={draft[t.id] ?? 0}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [t.id]: Math.max(0, Number(e.target.value) || 0) }))
                        }
                        className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                      <span className="text-xs text-slate-400 w-16">/ {formatDays(entitled)} days</span>
                    </div>
                  </div>
                );
              })}
              {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
            </div>
            <div className="flex items-center gap-2 p-4 border-t border-slate-200">
              <button
                onClick={saveEdit}
                disabled={saving}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEditingEmployeeId(null)}
                disabled={saving}
                className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
