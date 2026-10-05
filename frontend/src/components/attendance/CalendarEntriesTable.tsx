'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  CalendarApiError,
  WEEKDAY_NAMES,
  type CalendarEntry,
  type CalendarEntryType,
  type RecurringWfhRule,
} from '@/lib/api/calendar';
import type { CalendarDataSource } from '@/lib/api/calendars';

const TYPE_TABS: { id: CalendarEntryType; label: string; singular: string }[] = [
  { id: 'holiday', label: 'Holidays', singular: 'holiday' },
  { id: 'event', label: 'Events', singular: 'event' },
  { id: 'wfh', label: 'WFH days', singular: 'WFH day' },
];

const inputClass =
  'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/10';

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-indigo-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

interface RowDraft {
  name: string;
  date: string;
  optional: boolean;
  special: boolean;
}

/** One row of inputs, used both for "add" and for inline edit. */
function EntryEditorRow({
  draft,
  onChange,
  year,
  showFlags,
  placeholder,
  saving,
  onSave,
  onCancel,
}: {
  draft: RowDraft;
  onChange: (next: RowDraft) => void;
  year: number;
  showFlags: boolean;
  placeholder: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const valid = draft.name.trim() !== '' && draft.date !== '';
  return (
    <tr className="border-b border-slate-100 bg-slate-50/60">
      <td className="px-4 py-3">
        <input
          type="text"
          autoFocus
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !saving) onSave();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder={placeholder}
          className={inputClass}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="date"
          value={draft.date}
          min={`${year}-01-01`}
          max={`${year}-12-31`}
          onChange={(e) => onChange({ ...draft, date: e.target.value })}
          className={inputClass}
        />
      </td>
      {showFlags ? (
        <>
          <td className="px-4 py-3">
            <Toggle
              label="Optional"
              checked={draft.optional}
              onChange={(optional) => onChange({ ...draft, optional })}
            />
          </td>
          <td className="px-4 py-3">
            <Toggle
              label="Special"
              checked={draft.special}
              onChange={(special) => onChange({ ...draft, special })}
            />
          </td>
        </>
      ) : null}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onSave}
            disabled={!valid || saving}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Per-calendar, per-year list of holidays (plus events and WFH days). Replaces the
 *  month-grid editor: add a row, set name/date/flags, done. */
export function CalendarEntriesTable({
  source,
}: {
  source: CalendarDataSource;
}) {
  const thisYear = new Date().getFullYear();
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [rules, setRules] = useState<RecurringWfhRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<CalendarEntryType>('holiday');
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState<RowDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RowDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [ruleWeekday, setRuleWeekday] = useState(3);
  const [ruleLabel, setRuleLabel] = useState('');

  const refresh = useCallback(async () => {
    const [e, r] = await Promise.all([source.getEntries(), source.getRecurringWfhRules()]);
    setEntries(e);
    setRules(r);
  }, [source]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    refresh()
      .catch((e) => active && setLoadError(e instanceof Error ? e.message : 'Failed to load dates'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refresh]);

  const years = useMemo(() => {
    const set = new Set<number>([thisYear + 1, thisYear, thisYear - 1]);
    for (const e of entries) set.add(Number(e.date.slice(0, 4)));
    return Array.from(set).sort((a, b) => b - a);
  }, [entries, thisYear]);

  const rows = useMemo(
    () =>
      entries
        .filter((e) => e.type === type && e.date.startsWith(`${year}-`))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [entries, type, year],
  );

  const tab = TYPE_TABS.find((t) => t.id === type)!;
  const showFlags = type === 'holiday';

  const guard = async (action: () => Promise<unknown>, fallback: string) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof CalendarApiError || e instanceof Error ? e.message : fallback);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startAdd = () => {
    setEditingId(null);
    setAdding({ name: '', date: '', optional: false, special: false });
  };

  const saveAdd = async () => {
    if (!adding) return;
    const ok = await guard(
      () =>
        source.createEntry({
          type,
          date: adding.date,
          name: adding.name.trim(),
          ...(showFlags ? { optional: adding.optional, special: adding.special } : {}),
        }),
      `Could not add this ${tab.singular}`,
    );
    if (ok) setAdding(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft) return;
    const ok = await guard(
      () =>
        source.updateEntry(editingId, {
          name: editDraft.name.trim(),
          date: editDraft.date,
          ...(showFlags ? { optional: editDraft.optional, special: editDraft.special } : {}),
        }),
      `Could not update this ${tab.singular}`,
    );
    if (ok) setEditingId(null);
  };

  const deleting = entries.find((e) => e.id === deletingId);
  const colCount = showFlags ? 5 : 3;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Year">
          {years.map((y) => (
            <button
              key={y}
              role="tab"
              aria-selected={y === year}
              onClick={() => {
                setYear(y);
                setAdding(null);
                setEditingId(null);
              }}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                y === year ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        <button
          onClick={startAdd}
          disabled={Boolean(adding) || loading}
          className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-40"
        >
          + Add {tab.singular}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {TYPE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setType(t.id);
              setAdding(null);
              setEditingId(null);
              setError(null);
            }}
            className={`px-3 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
              t.id === type
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">{tab.singular} name</th>
                <th className="px-4 py-2.5 w-44">Date</th>
                {showFlags ? (
                  <>
                    <th className="px-4 py-2.5 w-24">Optional</th>
                    <th className="px-4 py-2.5 w-24">Special</th>
                  </>
                ) : null}
                <th className="px-4 py-2.5 w-36" />
              </tr>
            </thead>
            <tbody>
              {adding ? (
                <EntryEditorRow
                  draft={adding}
                  onChange={setAdding}
                  year={year}
                  showFlags={showFlags}
                  placeholder={`${tab.singular[0].toUpperCase()}${tab.singular.slice(1)} name`}
                  saving={saving}
                  onSave={saveAdd}
                  onCancel={() => setAdding(null)}
                />
              ) : null}

              {rows.length === 0 && !adding ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-slate-400">
                    No {tab.label.toLowerCase()} added for {year}.
                  </td>
                </tr>
              ) : null}

              {rows.map((entry) =>
                editingId === entry.id && editDraft ? (
                  <EntryEditorRow
                    key={entry.id}
                    draft={editDraft}
                    onChange={setEditDraft}
                    year={year}
                      showFlags={showFlags}
                    placeholder="Name"
                    saving={saving}
                    onSave={saveEdit}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={entry.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{entry.name}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(entry.date)}</td>
                    {showFlags ? (
                      <>
                        <td className="px-4 py-3 text-slate-600">{entry.optional ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-3 text-slate-600">{entry.special ? 'Yes' : 'No'}</td>
                      </>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => {
                            setAdding(null);
                            setEditingId(entry.id);
                            setEditDraft({
                              name: entry.name,
                              date: entry.date,
                              optional: Boolean(entry.optional),
                              special: Boolean(entry.special),
                            });
                          }}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeletingId(entry.id)}
                          className="text-xs font-semibold text-red-500 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {type === 'wfh' && !loading && !loadError ? (
        <div className="space-y-3 pt-2">
          <h4 className="text-sm font-bold text-slate-900">Recurring WFH days</h4>
          {rules.length === 0 ? <p className="text-xs text-slate-400">No recurring WFH days.</p> : null}
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-4 py-2.5"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{rule.label}</p>
                <p className="text-xs text-slate-500">Every {WEEKDAY_NAMES[rule.weekday]}</p>
              </div>
              <div className="flex items-center gap-3">
                <Toggle
                  label={`${rule.label} active`}
                  checked={rule.active}
                  onChange={(active) =>
                    guard(() => source.updateRecurringWfhRule(rule.id, { active }), 'Could not update this rule')
                  }
                />
                <button
                  onClick={() => guard(() => source.deleteRecurringWfhRule(rule.id), 'Could not remove this rule')}
                  className="text-xs font-semibold text-red-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={ruleWeekday}
              onChange={(e) => setRuleWeekday(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-2.5 py-2 bg-white"
              aria-label="Weekday"
            >
              {WEEKDAY_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  Every {n}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={ruleLabel}
              onChange={(e) => setRuleLabel(e.target.value)}
              placeholder="Label (optional)"
              className="flex-1 min-w-[10rem] text-sm border border-slate-200 rounded-lg px-3 py-2"
            />
            <button
              onClick={async () => {
                const ok = await guard(
                  () => source.createRecurringWfhRule({ weekday: ruleWeekday, label: ruleLabel.trim() || undefined }),
                  'Could not add this rule',
                );
                if (ok) setRuleLabel('');
              }}
              disabled={saving}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Add rule
            </button>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete ${tab.singular}?`}
          message={`"${deleting.name}" on ${fmtDate(deleting.date)} will be removed from this calendar.`}
          onConfirm={async () => {
            await guard(() => source.deleteEntry(deleting.id), `Could not delete this ${tab.singular}`);
            setDeletingId(null);
          }}
          onCancel={() => setDeletingId(null)}
        />
      ) : null}
    </div>
  );
}
