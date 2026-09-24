'use client';

import { useState } from 'react';
import type { LeaveType } from '@/lib/api/leave';
import { SAMPLE_EMPLOYEES } from '@/lib/attendance/sample-employees';

const ALL = 'All';

/** Deterministic pseudo-random "days used" for an employee/leave-type pair,
 *  so the sample table looks populated without needing a real ledger, and
 *  without changing on every re-render. */
function seededUsed(seed: string, max: number): number {
  if (max <= 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % (max + 1);
}

type Overrides = Record<string, Record<string, number>>; // employeeId -> leaveTypeId -> used

/** Settings > Leave Settings > Leave Balances. There's no employee directory
 *  or balance ledger in the mock backend yet, so this uses the same small
 *  sample roster as Shifts (see sample-employees.ts) and derives a stable
 *  "used" figure per employee/leave-type - HR can override it per employee,
 *  kept in local state only. Entitlement always reflects each leave type's
 *  current annual allocation, so editing a type in the Leave Types tab is
 *  reflected here immediately. */
export function LeaveBalancesPanel({ types }: { types: LeaveType[] }) {
  const [businessUnit, setBusinessUnit] = useState(ALL);
  const [department, setDepartment] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});

  const businessUnits = [ALL, ...Array.from(new Set(SAMPLE_EMPLOYEES.map((e) => e.businessUnit)))];
  const departments = [ALL, ...Array.from(new Set(SAMPLE_EMPLOYEES.map((e) => e.department)))];
  const locations = [ALL, ...Array.from(new Set(SAMPLE_EMPLOYEES.map((e) => e.location)))];

  const filtered = SAMPLE_EMPLOYEES.filter(
    (e) =>
      (businessUnit === ALL || e.businessUnit === businessUnit) &&
      (department === ALL || e.department === department) &&
      (location === ALL || e.location === location) &&
      (e.name.toLowerCase().includes(search.toLowerCase()) || e.employeeNumber.toLowerCase().includes(search.toLowerCase())),
  );

  const usedFor = (employeeId: string, type: LeaveType) =>
    overrides[employeeId]?.[type.id] ?? seededUsed(`${employeeId}-${type.id}`, type.annual_allocation);

  const startEdit = (employeeId: string) => {
    const current: Record<string, number> = {};
    types.forEach((t) => {
      current[t.id] = usedFor(employeeId, t);
    });
    setDraft(current);
    setEditingEmployeeId(employeeId);
  };

  const saveEdit = () => {
    if (!editingEmployeeId) return;
    setOverrides((prev) => ({ ...prev, [editingEmployeeId]: draft }));
    setEditingEmployeeId(null);
  };

  const editingEmployee = SAMPLE_EMPLOYEES.find((e) => e.id === editingEmployeeId);

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
                <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.employeeNumber}</td>
                <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.businessUnit}</td>
                <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.department}</td>
                <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{emp.location}</td>
                {types.map((t) => (
                  <td key={t.id} className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">
                    {usedFor(emp.id, t)}/{t.annual_allocation} days
                  </td>
                ))}
                <td className="px-5 py-4 text-sm whitespace-nowrap">
                  <button onClick={() => startEdit(emp.id)} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
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
              {types.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3">
                  <label className="text-sm text-slate-700">{t.name}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={t.annual_allocation}
                      value={draft[t.id] ?? 0}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [t.id]: Math.max(0, Number(e.target.value) || 0) }))
                      }
                      className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                    />
                    <span className="text-xs text-slate-400 w-16">/ {t.annual_allocation} days</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 p-4 border-t border-slate-200">
              <button
                onClick={saveEdit}
                className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                onClick={() => setEditingEmployeeId(null)}
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
