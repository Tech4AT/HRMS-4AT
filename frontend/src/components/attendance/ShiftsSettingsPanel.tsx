'use client';

import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { getEmployeeDirectory, type DirectoryEmployee } from '@/lib/api/employees';
import {
  shiftsApi,
  ShiftsApiError,
  formatMinutes,
  formatShiftTime,
  shiftWorkingMinutes,
  type Shift,
} from '@/lib/api/shifts';

type ShiftDraft = {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  employeeIds: string[];
};

const EMPTY_DRAFT: ShiftDraft = { name: '', startTime: '09:30', endTime: '18:30', breakMinutes: 60, employeeIds: [] };

function employeeNames(ids: string[], employees: DirectoryEmployee[]): string {
  if (ids.length === 0) return 'No employees assigned';
  return ids
    .map((id) => employees.find((e) => e.id === id)?.name)
    .filter(Boolean)
    .join(', ');
}

/** Full-roster picker for assigning employees to a shift - a flat list of
 * pills doesn't scale once there are more than a handful of employees, so
 * this opens as a popup with search and per-department "select all" instead. */
function AssignEmployeesModal({
  employees,
  initialSelected,
  onCancel,
  onConfirm,
}: {
  employees: DirectoryEmployee[];
  initialSelected: string[];
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState('');

  const departments = Array.from(new Set(employees.map((e) => e.department)));

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const departmentMemberIds = (department: string) =>
    employees.filter((e) => e.department === department).map((e) => e.id);

  const toggleDepartment = (department: string) => {
    const ids = departmentMemberIds(department);
    const allSelected = ids.every((id) => selected.includes(id));
    setSelected((prev) =>
      allSelected ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])),
    );
  };

  const filteredByDepartment = departments
    .map((department) => ({
      department,
      members: employees.filter(
        (e) => e.department === department && e.name.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter(({ members }) => members.length > 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Assign employees</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 border-b border-slate-200">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {filteredByDepartment.length === 0 ? (
            <p className="text-sm text-slate-400">No employees match your search.</p>
          ) : (
            filteredByDepartment.map(({ department, members }) => {
              const allSelected = departmentMemberIds(department).every((id) => selected.includes(id));
              return (
                <div key={department}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-500 uppercase">{department}</span>
                    <button
                      type="button"
                      onClick={() => toggleDepartment(department)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      {allSelected ? 'Unselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    {members.map((emp) => (
                      <label
                        key={emp.id}
                        className="flex items-center gap-2 text-sm text-slate-700 py-1 px-1.5 rounded-md hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(emp.id)}
                          onChange={() => toggle(emp.id)}
                          className="rounded border-slate-300"
                        />
                        {emp.name}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-200">
          <p className="text-xs text-slate-500">{selected.length} selected</p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selected)}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShiftForm({
  draft,
  employees,
  onChange,
  onCancel,
  onSave,
  saving,
  error,
}: {
  draft: ShiftDraft;
  employees: DirectoryEmployee[];
  onChange: (next: ShiftDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [assigning, setAssigning] = useState(false);

  return (
    <div className="border border-slate-200 rounded-lg p-4 space-y-4 bg-slate-50">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Shift name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="e.g. General Shift"
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Start time</label>
          <input
            type="time"
            value={draft.startTime}
            onChange={(e) => onChange({ ...draft, startTime: e.target.value })}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">End time</label>
          <input
            type="time"
            value={draft.endTime}
            onChange={(e) => onChange({ ...draft, endTime: e.target.value })}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Break (minutes)</label>
          <input
            type="number"
            min={0}
            max={240}
            value={draft.breakMinutes}
            onChange={(e) => onChange({ ...draft, breakMinutes: Math.max(0, Number(e.target.value) || 0) })}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Assigned employees</label>
        <button
          type="button"
          onClick={() => setAssigning(true)}
          className="w-full text-left text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 hover:bg-white transition-colors"
        >
          {draft.employeeIds.length ? employeeNames(draft.employeeIds, employees) : 'No employees assigned — click to assign'}
        </button>
        {assigning ? (
          <AssignEmployeesModal
            employees={employees}
            initialSelected={draft.employeeIds}
            onCancel={() => setAssigning(false)}
            onConfirm={(ids) => {
              onChange({ ...draft, employeeIds: ids });
              setAssigning(false);
            }}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving || !draft.name.trim() || !draft.startTime || !draft.endTime}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save shift'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Settings > Shifts. Real data (PLAN.md Step 6/11): shifts persist via
 *  `shiftsApi`, and the assignment picker draws from the real employee
 *  directory (`/api/employees` + `/api/departments`) instead of a sample
 *  roster. */
export function ShiftsSettingsPanel() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<ShiftDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ShiftDraft>(EMPTY_DRAFT);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([shiftsApi.getShifts(), getEmployeeDirectory()])
      .then(([shiftList, employeeList]) => {
        setShifts(shiftList);
        setEmployees(employeeList);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load shifts'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const startAdd = () => {
    setEditingId(null);
    setNewDraft(EMPTY_DRAFT);
    setFormError(null);
    setAddingNew(true);
  };

  const saveNew = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await shiftsApi.createShift({ ...newDraft, name: newDraft.name.trim() });
      setAddingNew(false);
      refresh();
    } catch (e) {
      setFormError(e instanceof ShiftsApiError ? e.message : 'Could not create this shift');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (shift: Shift) => {
    setAddingNew(false);
    setEditingId(shift.id);
    setFormError(null);
    setEditDraft({
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      employeeIds: shift.employeeIds,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    setFormError(null);
    try {
      await shiftsApi.updateShift(editingId, { ...editDraft, name: editDraft.name.trim() });
      setEditingId(null);
      refresh();
    } catch (e) {
      setFormError(e instanceof ShiftsApiError ? e.message : 'Could not update this shift');
    } finally {
      setSaving(false);
    }
  };

  const deleteShift = async (id: string) => {
    try {
      await shiftsApi.deleteShift(id);
      if (editingId === id) setEditingId(null);
      refresh();
    } catch {
      // Leave the row in place — the list stays accurate either way on refresh.
    } finally {
      setDeletingId(null);
    }
  };

  const deletingShift = shifts.find((s) => s.id === deletingId);

  return (
    <div className="max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Shifts</h3>
          <p className="text-xs text-slate-500 mt-1">Define work shifts and assign them to employees.</p>
        </div>
        {addingNew || loading ? null : (
          <button
            onClick={startAdd}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
          >
            Add shift
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading shifts…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <>
          {addingNew ? (
            <ShiftForm
              draft={newDraft}
              employees={employees}
              onChange={setNewDraft}
              onCancel={() => setAddingNew(false)}
              onSave={saveNew}
              saving={saving}
              error={formError}
            />
          ) : null}

          {shifts.length === 0 && !addingNew ? (
            <p className="text-sm text-slate-400">No shifts have been created yet.</p>
          ) : (
            <div className="space-y-3">
              {shifts.map((shift) =>
                editingId === shift.id ? (
                  <ShiftForm
                    key={shift.id}
                    draft={editDraft}
                    employees={employees}
                    onChange={setEditDraft}
                    onCancel={() => setEditingId(null)}
                    onSave={saveEdit}
                    saving={saving}
                    error={formError}
                  />
                ) : (
                  <div key={shift.id} className="border border-slate-200 rounded-lg px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{shift.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatShiftTime(shift.startTime)} – {formatShiftTime(shift.endTime)} · {shift.breakMinutes}m break ·{' '}
                          {formatMinutes(shiftWorkingMinutes(shift))} working
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{employeeNames(shift.employeeIds, employees)}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => startEdit(shift)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeletingId(shift.id)}
                          className="text-xs font-semibold text-red-500 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}

      {deletingShift ? (
        <ConfirmDialog
          title="Delete shift?"
          message={`This will permanently delete "${deletingShift.name}" and unassign its ${deletingShift.employeeIds.length} employee(s).`}
          onConfirm={() => deleteShift(deletingShift.id)}
          onCancel={() => setDeletingId(null)}
        />
      ) : null}
    </div>
  );
}
