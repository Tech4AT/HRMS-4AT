'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  calendarApi,
  CalendarApiError,
  WEEKDAY_NAMES,
  type CalendarEntry,
  type CalendarEntryType,
  type RecurringWfhRule,
} from '@/lib/api/calendar';
import { mondayFirstOffset, WEEKDAY_LABELS_MONDAY_FIRST } from '@/lib/attendance/calendar-grid';
import { toLocalISODate } from '@/lib/attendance/view';

const typeMeta: Record<CalendarEntryType, { label: string; dot: string; pillClass: string }> = {
  holiday: { label: 'Holiday', dot: 'bg-amber-500', pillClass: 'bg-amber-100 text-amber-700' },
  wfh: { label: 'WFH Day', dot: 'bg-blue-500', pillClass: 'bg-blue-100 text-blue-700' },
  event: { label: 'Event', dot: 'bg-fuchsia-500', pillClass: 'bg-fuchsia-100 text-fuchsia-700' },
};

function fmtDayHeading(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

type NewEntryMode = CalendarEntryType | 'wfh-recurring';

/** HR-admin editor for the org-wide calendar: holidays, one-off/recurring WFH
 *  days, and special events. Click any day to add/edit/remove entries for it.
 *  Lives under Settings > Calendar Management (calendar.manage). The
 *  read-only counterpart employees see is
 *  components/attendance/MyAttendanceCalendar, under My Attendance > Calendar. */
export function CalendarManagementPanel() {
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [rules, setRules] = useState<RecurringWfhRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [newMode, setNewMode] = useState<NewEntryMode>('holiday');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [e, r] = await Promise.all([calendarApi.getEntries(), calendarApi.getRecurringWfhRules()]);
    setEntries(e);
    setRules(r);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    refresh()
      .catch((e) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load the calendar');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  const resetNewEntryForm = () => {
    setNewMode('holiday');
    setNewName('');
    setNewDescription('');
    setEditingEntryId(null);
  };

  const openDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    resetNewEntryForm();
  };

  const closePanel = () => setSelectedDate(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const todayStr = toLocalISODate(new Date());

  const entriesByDate = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [entries]);

  const activeRuleByWeekday = useMemo(() => {
    const m = new Map<number, RecurringWfhRule>();
    for (const r of rules) {
      if (r.active) m.set(r.weekday, r);
    }
    return m;
  }, [rules]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = mondayFirstOffset(new Date(year, month, 1));
  const cells: (string | null)[] = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toLocalISODate(new Date(year, month, day)));
  }

  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const goToMonth = (delta: number) => setViewDate(new Date(year, month + delta, 1));
  const goToToday = () => {
    const now = new Date();
    setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const selectedDow = selectedDate ? new Date(`${selectedDate}T00:00:00`).getDay() : null;
  const selectedEntries = selectedDate ? (entriesByDate.get(selectedDate) ?? []) : [];
  const selectedRecurringRule = selectedDow != null ? rules.find((r) => r.weekday === selectedDow) : undefined;

  const handleAddForDay = async () => {
    if (!selectedDate || selectedDow == null) return;
    if (newMode !== 'wfh-recurring' && !newName.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      if (newMode === 'wfh-recurring') {
        await calendarApi.createRecurringWfhRule({
          weekday: selectedDow,
          label: newName.trim() || `Every ${WEEKDAY_NAMES[selectedDow]}`,
        });
        setActionMessage(`Every ${WEEKDAY_NAMES[selectedDow]} is now a recurring WFH day.`);
      } else {
        await calendarApi.createEntry({
          type: newMode,
          date: selectedDate,
          name: newName.trim(),
          description: newDescription.trim() || undefined,
        });
        setActionMessage('Calendar entry added.');
      }
      resetNewEntryForm();
      await refresh();
    } catch (e) {
      setActionError(e instanceof CalendarApiError ? e.message : 'Could not save this calendar entry');
    } finally {
      setSaving(false);
    }
  };

  const startEditEntry = (entry: CalendarEntry) => {
    setEditingEntryId(entry.id);
    setEditName(entry.name);
    setEditDescription(entry.description ?? '');
  };

  const handleSaveEditEntry = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await calendarApi.updateEntry(id, { name: editName.trim(), description: editDescription.trim() || null });
      setActionMessage('Calendar entry updated.');
      setEditingEntryId(null);
      await refresh();
    } catch (e) {
      setActionError(e instanceof CalendarApiError ? e.message : 'Could not update this calendar entry');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await calendarApi.deleteEntry(id);
      setActionMessage('Calendar entry deleted.');
      await refresh();
    } catch (e) {
      setActionError(e instanceof CalendarApiError ? e.message : 'Could not delete this calendar entry');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleRecurring = async (rule: RecurringWfhRule) => {
    setBusyId(rule.id);
    setActionError(null);
    try {
      await calendarApi.updateRecurringWfhRule(rule.id, { active: !rule.active });
      await refresh();
    } catch (e) {
      setActionError(e instanceof CalendarApiError ? e.message : 'Could not update this recurring WFH day');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveRecurring = async (rule: RecurringWfhRule) => {
    setBusyId(rule.id);
    setActionError(null);
    try {
      await calendarApi.deleteRecurringWfhRule(rule.id);
      setActionMessage('Recurring WFH day removed.');
      await refresh();
    } catch (e) {
      setActionError(e instanceof CalendarApiError ? e.message : 'Could not remove this recurring WFH day');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Click any day to add a holiday, a one-off or recurring WFH day, or a special event. Changes apply
        organisation-wide immediately.
      </p>

      {(actionMessage || actionError) && (
        <div
          className={`rounded-lg text-sm px-4 py-3 ${
            actionError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionError || actionMessage}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading calendar…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 items-start">
          {/* Month grid */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900">{monthLabel}</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => goToMonth(-1)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                  aria-label="Previous month"
                >
                  ‹
                </button>
                <button
                  onClick={goToToday}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Today
                </button>
                <button
                  onClick={() => goToMonth(1)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                  aria-label="Next month"
                >
                  ›
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 mb-3 text-[11px] font-medium text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Holiday
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" /> WFH
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-fuchsia-500" /> Event
              </span>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold text-slate-400 uppercase mb-2">
              {WEEKDAY_LABELS_MONDAY_FIRST.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((dateStr, i) => {
                if (!dateStr) return <div key={i} />;
                const dow = new Date(`${dateStr}T00:00:00`).getDay();
                const dayEntries = entriesByDate.get(dateStr) ?? [];
                const recurringRule = activeRuleByWeekday.get(dow);
                const hasHoliday = dayEntries.some((e) => e.type === 'holiday');
                const hasWfh = dayEntries.some((e) => e.type === 'wfh') || Boolean(recurringRule);
                const hasEvent = dayEntries.some((e) => e.type === 'event');
                const isToday = dateStr === todayStr;
                const isSelected = dateStr === selectedDate;

                return (
                  <button
                    key={dateStr}
                    onClick={() => openDay(dateStr)}
                    className={`aspect-square rounded-lg border p-1.5 flex flex-col items-center justify-start transition-colors ${
                      isSelected
                        ? 'border-indigo-500 ring-2 ring-indigo-200'
                        : hasHoliday
                          ? 'border-amber-200 bg-amber-50 hover:bg-amber-100'
                          : 'border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`text-xs font-semibold ${
                        isToday ? 'w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center' : 'text-slate-700'
                      }`}
                    >
                      {Number(dateStr.slice(-2))}
                    </span>
                    <span className="flex items-center gap-0.5 mt-1">
                      {hasHoliday ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> : null}
                      {hasWfh ? <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> : null}
                      {hasEvent ? <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Day panel */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 xl:sticky xl:top-4">
            {!selectedDate ? (
              <p className="text-sm text-slate-400">Select a day on the calendar to view or add entries.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">{fmtDayHeading(selectedDate)}</h3>
                  <button onClick={closePanel} className="text-slate-400 hover:text-slate-600 text-sm">
                    ✕
                  </button>
                </div>

                {selectedRecurringRule ? (
                  <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-blue-700">🔁 {selectedRecurringRule.label}</p>
                        <p className="text-[11px] text-blue-600 mt-0.5">
                          Recurring every {WEEKDAY_NAMES[selectedRecurringRule.weekday]} - applies to all employees
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${
                          selectedRecurringRule.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {selectedRecurringRule.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => handleToggleRecurring(selectedRecurringRule)}
                        disabled={busyId === selectedRecurringRule.id}
                        className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-50"
                      >
                        {selectedRecurringRule.active ? 'Turn off' : 'Turn on'}
                      </button>
                      <button
                        onClick={() => handleRemoveRecurring(selectedRecurringRule)}
                        disabled={busyId === selectedRecurringRule.id}
                        className="text-[11px] font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        Remove rule
                      </button>
                    </div>
                  </div>
                ) : null}

                {selectedEntries.length === 0 ? (
                  <p className="text-xs text-slate-400">No one-off entries on this day.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedEntries.map((entry) => (
                      <div key={entry.id} className="border border-slate-200 rounded-lg px-3 py-2.5">
                        {editingEntryId === entry.id ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                            />
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Description (optional)"
                              className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleSaveEditEntry(entry.id)}
                                disabled={busyId === entry.id || !editName.trim()}
                                className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingEntryId(null)}
                                className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeMeta[entry.type].dot}`} />
                                  <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${typeMeta[entry.type].pillClass}`}>
                                    {typeMeta[entry.type].label}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-slate-900 mt-1 truncate">{entry.name}</p>
                                {entry.description ? (
                                  <p className="text-xs text-slate-500 mt-0.5">{entry.description}</p>
                                ) : null}
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <button
                                  onClick={() => startEditEntry(entry)}
                                  className="text-[11px] font-medium text-blue-600 hover:text-blue-700"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteEntry(entry.id)}
                                  disabled={busyId === entry.id}
                                  className="text-[11px] font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
                                >
                                  {busyId === entry.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Add to this day</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['holiday', 'Holiday'],
                        ['event', 'Event'],
                        ['wfh', 'WFH (this day)'],
                        ['wfh-recurring', `WFH every ${selectedDow != null ? WEEKDAY_NAMES[selectedDow] : ''}`],
                      ] as [NewEntryMode, string][]
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        onClick={() => setNewMode(mode)}
                        disabled={mode === 'wfh-recurring' && Boolean(selectedRecurringRule)}
                        className={`text-xs font-semibold px-2 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          newMode === mode
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {newMode === 'wfh-recurring' ? (
                    <>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={`Label (default: Every ${selectedDow != null ? WEEKDAY_NAMES[selectedDow] : ''})`}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                      <p className="text-[11px] text-slate-400">
                        This applies to every {selectedDow != null ? WEEKDAY_NAMES[selectedDow] : ''}, not just{' '}
                        {selectedDate ? fmtDayHeading(selectedDate) : ''}.
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={
                          newMode === 'holiday' ? 'e.g. Diwali' : newMode === 'event' ? 'e.g. Company Townhall' : 'e.g. Office deep-clean'
                        }
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                      <textarea
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                    </>
                  )}

                  <button
                    onClick={handleAddForDay}
                    disabled={saving || (newMode !== 'wfh-recurring' && !newName.trim())}
                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
