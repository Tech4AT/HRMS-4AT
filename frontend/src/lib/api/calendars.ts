/**
 * Helpers for the multi-calendar UI, on top of the backend-persisted
 * `calendarApi` (see ./calendar.ts). Calendars are independent peers - there is
 * no default or fallback calendar - and a person can follow several; the
 * backend combines them (holidays, events and WFH days are added together, a
 * day is a week-off if any of their calendars says so).
 */

import {
  calendarApi,
  type CalendarEntry,
  type CreateCalendarEntryInput,
  type CreateRecurringWfhRuleInput,
  type RecurringWfhRule,
  type UpdateCalendarEntryInput,
  type UpdateRecurringWfhRuleInput,
  type WeekOffRule,
} from './calendar';

/** What the dates table needs from one calendar's data. */
export interface CalendarDataSource {
  getEntries: () => Promise<CalendarEntry[]>;
  createEntry: (input: Omit<CreateCalendarEntryInput, 'calendar_id'>) => Promise<CalendarEntry>;
  updateEntry: (id: string, input: UpdateCalendarEntryInput) => Promise<CalendarEntry>;
  deleteEntry: (id: string) => Promise<null>;
  getRecurringWfhRules: () => Promise<RecurringWfhRule[]>;
  createRecurringWfhRule: (input: Omit<CreateRecurringWfhRuleInput, 'calendar_id'>) => Promise<RecurringWfhRule>;
  updateRecurringWfhRule: (id: string, input: UpdateRecurringWfhRuleInput) => Promise<RecurringWfhRule>;
  deleteRecurringWfhRule: (id: string) => Promise<null>;
}

/** The dates API scoped to a single calendar. */
export function calendarDataSource(calendarId: string): CalendarDataSource {
  return {
    getEntries: () => calendarApi.getEntries({ calendarId }),
    createEntry: (input) => calendarApi.createEntry({ ...input, calendar_id: calendarId }),
    updateEntry: calendarApi.updateEntry,
    deleteEntry: calendarApi.deleteEntry,
    getRecurringWfhRules: () => calendarApi.getRecurringWfhRules(calendarId),
    createRecurringWfhRule: (input) => calendarApi.createRecurringWfhRule({ ...input, calendar_id: calendarId }),
    updateRecurringWfhRule: calendarApi.updateRecurringWfhRule,
    deleteRecurringWfhRule: calendarApi.deleteRecurringWfhRule,
  };
}

export const DEFAULT_NEW_WEEK_OFFS: WeekOffRule[] = [
  { weekday: 6, weeks: [] },
  { weekday: 0, weeks: [] },
];

const ordinal = (n: number) => ['', '1st', '2nd', '3rd', '4th', '5th'][n] ?? `${n}th`;

export function describeWeekOff(rule: WeekOffRule, names: string[]): string {
  const day = names[rule.weekday];
  return rule.weeks.length === 0 ? `${day} (every week)` : `${day} (${rule.weeks.map(ordinal).join(', ')})`;
}

/** Monday-first ordering of weekly-off rules for display. */
export function sortWeekOffs(rules: WeekOffRule[]): WeekOffRule[] {
  return [...rules].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
}

/** True when `date` is a week-off under `rules` (one calendar's rules). */
export function isWeekOff(date: Date, rules: WeekOffRule[]): boolean {
  const rule = rules.find((r) => r.weekday === date.getDay());
  if (!rule) return false;
  if (rule.weeks.length === 0) return true;
  return rule.weeks.includes(Math.ceil(date.getDate() / 7));
}
