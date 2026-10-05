'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CalendarEntriesTable } from '@/components/attendance/CalendarEntriesTable';
import { AssignEmployeesModal } from '@/components/attendance/ShiftsSettingsPanel';
import {
  calendarApi,
  WEEKDAY_NAMES,
  type Calendar,
  type CalendarCoverage,
  type CalendarInput,
  type WeekOffRule,
} from '@/lib/api/calendar';
import {
  calendarDataSource,
  DEFAULT_NEW_WEEK_OFFS,
  describeWeekOff,
  sortWeekOffs,
} from '@/lib/api/calendars';
import { getDepartments, getEmployeeDirectory, type DirectoryEmployee } from '@/lib/api/employees';

const EMPTY_DRAFT: CalendarInput = {
  name: '',
  description: '',
  department_ids: [],
  employee_ids: [],
  week_offs: DEFAULT_NEW_WEEK_OFFS,
};

// Monday-first display order, Sunday-first storage (0 = Sunday).
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const inputClass =
  'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function WeekOffEditor({ value, onChange }: { value: WeekOffRule[]; onChange: (next: WeekOffRule[]) => void }) {
  const ruleFor = (weekday: number) => value.find((r) => r.weekday === weekday);

  const setRule = (weekday: number, rule: WeekOffRule | null) => {
    const rest = value.filter((r) => r.weekday !== weekday);
    onChange(rule ? [...rest, rule] : rest);
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white divide-y divide-slate-100">
      {WEEKDAY_DISPLAY_ORDER.map((weekday) => {
        const rule = ruleFor(weekday);
        const mode = !rule ? 'working' : rule.weeks.length === 0 ? 'every' : 'some';
        return (
          <div key={weekday} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
            <span className="w-24 text-sm font-medium text-slate-700">{WEEKDAY_NAMES[weekday]}</span>
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value;
                if (next === 'working') setRule(weekday, null);
                else if (next === 'every') setRule(weekday, { weekday, weeks: [] });
                else setRule(weekday, { weekday, weeks: [2, 4] });
              }}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white"
              aria-label={`${WEEKDAY_NAMES[weekday]} pattern`}
            >
              <option value="working">Working day</option>
              <option value="every">Off every week</option>
              <option value="some">Off on selected weeks…</option>
            </select>
            {mode === 'some' && rule ? (
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = rule.weeks.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        const weeks = on ? rule.weeks.filter((w) => w !== n) : [...rule.weeks, n].sort();
                        // Clearing every week would silently turn this into "off every week".
                        if (weeks.length > 0) setRule(weekday, { weekday, weeks });
                      }}
                      className={`text-xs font-semibold w-8 h-8 rounded-lg border transition-colors ${
                        on
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                      aria-pressed={on}
                      aria-label={`${['', '1st', '2nd', '3rd', '4th', '5th'][n]} ${WEEKDAY_NAMES[weekday]}`}
                    >
                      {n}
                    </button>
                  );
                })}
                <span className="text-xs text-slate-400">of the month</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CalendarForm({
  draft,
  employees,
  departments,
  onChange,
  onCancel,
  onSave,
  saving,
  error,
}: {
  draft: CalendarInput;
  employees: DirectoryEmployee[];
  departments: { id: string; name: string }[];
  onChange: (next: CalendarInput) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [assigning, setAssigning] = useState(false);

  const toggleDepartment = (id: string) =>
    onChange({
      ...draft,
      department_ids: draft.department_ids.includes(id)
        ? draft.department_ids.filter((d) => d !== id)
        : [...draft.department_ids, id],
    });

  return (
    <div className="border border-slate-200 rounded-lg p-4 space-y-5 bg-slate-50">
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Calendar name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="e.g. Hyderabad Office, Support Team (alt. Saturdays)"
          maxLength={100}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
        <input
          type="text"
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          placeholder="Optional"
          maxLength={300}
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Weekly offs</label>
        <WeekOffEditor value={draft.week_offs} onChange={(week_offs) => onChange({ ...draft, week_offs })} />
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-semibold text-slate-600">Applies to</label>
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1.5">Departments</p>
          <div className="flex flex-wrap gap-1.5">
            {departments.length === 0 ? (
              <span className="text-xs text-slate-400">No departments found.</span>
            ) : (
              departments.map((d) => {
                const on = draft.department_ids.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDepartment(d.id)}
                    aria-pressed={on}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                      on
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {d.name}
                  </button>
                );
              })
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            A department covers its own members only, not its sub-departments.
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1.5">Individual employees</p>
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="w-full text-left text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white hover:bg-slate-50 transition-colors"
          >
            {draft.employee_ids.length
              ? `${plural(draft.employee_ids.length, 'employee')} selected — click to change`
              : 'No individual employees — click to assign'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Someone can follow several calendars. Their holidays, events and WFH days are added together, and a day is a
          weekly off if any of their calendars says so. A calendar that applies to nobody has no effect.
        </p>
        {assigning ? (
          <AssignEmployeesModal
            employees={employees}
            initialSelected={draft.employee_ids}
            onCancel={() => setAssigning(false)}
            onConfirm={(ids) => {
              onChange({ ...draft, employee_ids: ids });
              setAssigning(false);
            }}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving || !draft.name.trim()}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save calendar'}
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

function toDraft(c: Calendar): CalendarInput {
  return {
    name: c.name,
    description: c.description,
    department_ids: c.department_ids,
    employee_ids: c.employee_ids,
    week_offs: c.week_offs,
  };
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** Settings > Calendar Management. Master-detail like a holiday-plan screen: pick a
 *  calendar on the left; on the right, manage its holidays by year, who follows it,
 *  and its weekly offs. Calendars are independent and an employee can follow
 *  several; everything is persisted by the backend. */
export function CalendarsSettingsPanel() {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [coverage, setCoverage] = useState<CalendarCoverage | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'view' | 'new' | 'edit'>('view');
  const [draft, setDraft] = useState<CalendarInput>(EMPTY_DRAFT);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async (selectAfter?: string) => {
    try {
      const [list, people, depts, cover] = await Promise.all([
        calendarApi.getCalendars(),
        getEmployeeDirectory().catch(() => [] as DirectoryEmployee[]),
        getDepartments().catch(() => [] as { id: string; name: string }[]),
        calendarApi.getCoverage().catch(() => null),
      ]);
      setCalendars(list);
      setEmployees(people);
      setDepartments(depts);
      setCoverage(cover);
      setSelectedId((current) => selectAfter ?? (list.some((c) => c.id === current) ? current : (list[0]?.id ?? null)));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, 'Failed to load calendars'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = calendars.find((c) => c.id === selectedId);
  const selectedKey = selected?.id;
  const source = useMemo(() => (selectedKey ? calendarDataSource(selectedKey) : null), [selectedKey]);
  const visible = calendars.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const departmentNames = (ids: string[]) =>
    ids.map((id) => departments.find((d) => d.id === id)?.name).filter(Boolean) as string[];

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const body = { ...draft, name: draft.name.trim() };
      if (mode === 'new') {
        const created = await calendarApi.createCalendar(body);
        await refresh(created.id);
      } else if (selected) {
        await calendarApi.updateCalendar(selected.id, body);
        await refresh();
      }
      setMode('view');
    } catch (e) {
      setFormError(errorMessage(e, 'Could not save this calendar'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    try {
      await calendarApi.deleteCalendar(selected.id);
      await refresh();
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not delete this calendar'));
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = () => {
    if (!selected) return;
    setFormError(null);
    setDraft(toDraft(selected));
    setMode('edit');
  };

  const startNew = () => {
    setFormError(null);
    setDraft(EMPTY_DRAFT);
    setMode('new');
  };

  if (loading) return <p className="text-sm text-slate-500">Loading calendars…</p>;
  if (loadError && calendars.length === 0) return <p className="text-sm text-red-600">{loadError}</p>;

  const formOpen = mode === 'new' || (mode === 'edit' && selected);

  return (
    <div className="space-y-4">
      {loadError ? <p className="text-sm text-red-600">{loadError}</p> : null}
      {coverage && coverage.unassigned_count > 0 ? (
        <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-4 py-3">
          <p>
            {plural(coverage.unassigned_count, 'active employee')} {coverage.unassigned_count === 1 ? 'is' : 'are'} not
            covered by any calendar, so they have no weekly offs or holidays.{' '}
            <button onClick={() => setShowUnassigned((v) => !v)} className="font-semibold underline">
              {showUnassigned ? 'Hide' : 'Show who'}
            </button>
          </p>
          {showUnassigned ? (
            <ul className="mt-2 text-xs columns-2 sm:columns-3 gap-4">
              {coverage.unassigned.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {p.department ? ` · ${p.department}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Calendar list */}
        <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3 lg:sticky lg:top-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search calendars"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
          />
          <div className="space-y-1">
            {visible.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedId(c.id);
                  setMode('view');
                }}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                  c.id === selected?.id && mode !== 'new' ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900 truncate">{c.name}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{plural(c.employee_count, 'employee')}</span>
              </button>
            ))}
            {visible.length === 0 ? (
              <p className="text-xs text-slate-400 px-1">
                {calendars.length === 0 ? 'No calendars yet.' : 'No calendars match.'}
              </p>
            ) : null}
          </div>
          <button
            onClick={startNew}
            className="w-full text-sm font-semibold px-4 py-2.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          >
            + New calendar
          </button>
        </aside>

        {/* Detail */}
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5 min-w-0">
          {formOpen ? (
            <>
              <h2 className="text-lg font-bold text-slate-900">
                {mode === 'new' ? 'New calendar' : `Edit ${selected?.name}`}
              </h2>
              <CalendarForm
                draft={draft}
                employees={employees}
                departments={departments}
                onChange={setDraft}
                onCancel={() => setMode('view')}
                onSave={save}
                saving={saving}
                error={formError}
              />
            </>
          ) : selected && source ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900 truncate">{selected.name}</h2>
                  <p className="text-sm text-indigo-600 mt-1">
                    {plural(selected.employee_count, 'employee')} follow this calendar
                  </p>
                  {selected.description ? <p className="text-xs text-slate-500 mt-1">{selected.description}</p> : null}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={startEdit} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting(true)}
                    className="text-sm font-semibold text-red-500 hover:text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-5 items-start">
                <CalendarEntriesTable key={selected.id} source={source} />

                <div className="space-y-4">
                  <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                    <h3 className="text-sm font-bold text-slate-900">Assignment</h3>
                    {selected.department_ids.length === 0 && selected.employee_ids.length === 0 ? (
                      <p className="text-xs text-slate-500">Not assigned to anyone yet, so it has no effect.</p>
                    ) : (
                      <div className="text-xs text-slate-600 space-y-1">
                        {selected.department_ids.length ? (
                          <p>
                            <span className="font-medium">Departments:</span>{' '}
                            {departmentNames(selected.department_ids).join(', ')}
                          </p>
                        ) : null}
                        {selected.employee_ids.length ? (
                          <p>
                            <span className="font-medium">Individuals:</span>{' '}
                            {plural(selected.employee_ids.length, 'employee')}
                          </p>
                        ) : null}
                      </div>
                    )}
                    <button onClick={startEdit} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                      Change assignment
                    </button>
                  </div>

                  <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                    <h3 className="text-sm font-bold text-slate-900">Weekly offs</h3>
                    {selected.week_offs.length ? (
                      <ul className="text-xs text-slate-600 space-y-1">
                        {sortWeekOffs(selected.week_offs).map((r) => (
                          <li key={r.weekday}>{describeWeekOff(r, WEEKDAY_NAMES)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-400">No weekly offs.</p>
                    )}
                    <button onClick={startEdit} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                      Edit weekly offs
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Someone covered by several calendars gets the holidays, events, WFH days and weekly offs of all of
                    them. Optional holidays don&apos;t close the day.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center space-y-3">
              <p className="text-sm text-slate-500">
                No calendars yet. Create one, give it weekly offs and holidays, and assign it to departments or
                employees.
              </p>
              <button onClick={startNew} className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">
                + New calendar
              </button>
            </div>
          )}
        </section>
      </div>

      {deleting && selected ? (
        <ConfirmDialog
          title="Delete calendar?"
          message={`This permanently deletes "${selected.name}" and all its holidays, events, WFH days and weekly offs. The ${plural(selected.employee_count, 'employee')} following it will stop getting them.`}
          onConfirm={remove}
          onCancel={() => setDeleting(false)}
        />
      ) : null}
    </div>
  );
}
