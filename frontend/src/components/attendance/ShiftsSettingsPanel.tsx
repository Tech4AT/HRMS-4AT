'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  SAMPLE_SHIFTS,
  SAMPLE_SHIFT_EMPLOYEES,
  formatMinutes,
  formatShiftTime,
  shiftWorkingMinutes,
  type Shift,
} from '@/lib/attendance/shifts';

type ShiftDraft = {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  employeeIds: string[];
};

const EMPTY_DRAFT: ShiftDraft = { name: '', startTime: '09:30', endTime: '18:30', breakMinutes: 60, employeeIds: [] };

function employeeNames(ids: string[]): string {
  if (ids.length === 0) return 'No employees assigned';
  return ids
    .map((id) => SAMPLE_SHIFT_EMPLOYEES.find((e) => e.id === id)?.name)
    .filter(Boolean)
    .join(', ');
}

const TEAMS = Array.from(new Set(SAMPLE_SHIFT_EMPLOYEES.map((e) => e.team)));

/** Full-roster picker for assigning employees to a shift - a flat list of
 * pills doesn't scale once there are more than a handful of employees, so
 * this opens as a popup with search and per-team "select all" instead. */
function AssignEmployeesModal({
  initialSelected,
  onCancel,
  onConfirm,
}: {
  initialSelected: string[];
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState('');

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const teamMemberIds = (team: string) => SAMPLE_SHIFT_EMPLOYEES.filter((e) => e.team === team).map((e) => e.id);

  const toggleTeam = (team: string) => {
    const ids = teamMemberIds(team);
    const allSelected = ids.every((id) => selected.includes(id));
    setSelected((prev) =>
      allSelected ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])),
    );
  };

  const filteredByTeam = TEAMS.map((team) => ({
    team,
    members: SAMPLE_SHIFT_EMPLOYEES.filter((e) => e.team === team && e.name.toLowerCase().includes(search.toLowerCase())),
  })).filter(({ members }) => members.length > 0);

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
          {filteredByTeam.length === 0 ? (
            <p className="text-sm text-slate-400">No employees match your search.</p>
          ) : (
            filteredByTeam.map(({ team, members }) => {
              const allSelected = teamMemberIds(team).every((id) => selected.includes(id));
              return (
                <div key={team}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-500 uppercase">{team}</span>
                    <button
                      type="button"
                      onClick={() => toggleTeam(team)}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      {allSelected ? 'Unselect team' : 'Select team'}
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
  onChange,
  onCancel,
  onSave,
}: {
  draft: ShiftDraft;
  onChange: (next: ShiftDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [assigning, setAssigning] = useState(false);

  return (
    <div className="border border-slate-200 rounded-lg p-4 space-y-4 bg-slate-50">
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
          {draft.employeeIds.length ? employeeNames(draft.employeeIds) : 'No employees assigned — click to assign'}
        </button>
        {assigning ? (
          <AssignEmployeesModal
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
          disabled={!draft.name.trim() || !draft.startTime || !draft.endTime}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save shift
        </button>
        <button
          onClick={onCancel}
          className="text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Settings > Shifts. Frontend-only for now (no backend to persist to) -
 *  create shifts with a start/end time and break duration, and assign
 *  employees to each one from a small sample roster. */
export function ShiftsSettingsPanel() {
  const [shifts, setShifts] = useState<Shift[]>(SAMPLE_SHIFTS);
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<ShiftDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ShiftDraft>(EMPTY_DRAFT);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startAdd = () => {
    setEditingId(null);
    setNewDraft(EMPTY_DRAFT);
    setAddingNew(true);
  };

  const saveNew = () => {
    setShifts((prev) => [...prev, { id: `shift-${Date.now()}`, ...newDraft, name: newDraft.name.trim() }]);
    setAddingNew(false);
  };

  const startEdit = (shift: Shift) => {
    setAddingNew(false);
    setEditingId(shift.id);
    setEditDraft({
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      employeeIds: shift.employeeIds,
    });
  };

  const saveEdit = () => {
    setShifts((prev) =>
      prev.map((s) => (s.id === editingId ? { ...s, ...editDraft, name: editDraft.name.trim() } : s)),
    );
    setEditingId(null);
  };

  const deleteShift = (id: string) => {
    setShifts((prev) => prev.filter((s) => s.id !== id));
    if (editingId === id) setEditingId(null);
    setDeletingId(null);
  };

  const deletingShift = shifts.find((s) => s.id === deletingId);

  return (
    <div className="max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Shifts</h3>
          <p className="text-xs text-slate-500 mt-1">Define work shifts and assign them to employees.</p>
        </div>
        {addingNew ? null : (
          <button
            onClick={startAdd}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
          >
            Add shift
          </button>
        )}
      </div>

      {addingNew ? (
        <ShiftForm draft={newDraft} onChange={setNewDraft} onCancel={() => setAddingNew(false)} onSave={saveNew} />
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
                onChange={setEditDraft}
                onCancel={() => setEditingId(null)}
                onSave={saveEdit}
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
                    <p className="text-xs text-slate-400 mt-1">{employeeNames(shift.employeeIds)}</p>
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
