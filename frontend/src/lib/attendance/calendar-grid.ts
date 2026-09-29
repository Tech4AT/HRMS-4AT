/** Shared month-grid layout for every calendar UI in this app (the read-only
 *  view in MyAttendanceCalendar and the HR-admin editor in
 *  CalendarManagementPanel) - both must lay out the same way, Monday-first,
 *  so kept in one place rather than each screen defining its own weekday
 *  order and risking drift. This is purely a *display* convention: the
 *  underlying `RecurringWfhRule.weekday` field (and `Date#getDay()`) still
 *  use JS's native Sunday=0 numbering - only the grid's column order and
 *  header labels are Monday-first. */

export const WEEKDAY_LABELS_MONDAY_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** How many blank leading cells a month's 1st falls after, in a Monday-first
 *  grid (0 if the 1st is a Monday, ..., 6 if it's a Sunday). */
export function mondayFirstOffset(firstOfMonth: Date): number {
  return (firstOfMonth.getDay() + 6) % 7;
}
