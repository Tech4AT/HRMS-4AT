/** My Team view rules, kept out of the components so they can be checked on their
 *  own. Nothing here decides who may see what: the backend already did, and
 *  reports it per person as `level` / `presence` and in `coverage`. */

import type { Presence, TeamSummaryMember } from '@/lib/api/teamAttendance';
import type { EmployeeDayStatus } from '@/lib/attendance/dashboard';
import { fullName, type DirectoryPerson } from './groups';

export type MemberBadge = 'in' | 'not_in_yet' | 'on_leave' | 'absent' | null;

export interface Coverage {
  total: number;
  detail: number;
}

/** A group is only "complete" when the caller may read everyone in it in full. */
export function isCompleteCoverage(c: Coverage): boolean {
  return c.detail === c.total;
}

/** The label that stops leave / on-time / late / WFH figures from implying they
 *  describe everyone. `null` when nothing needs saying: nobody is covered (those
 *  figures aren't shown at all) or everyone is (the UI stays exactly as it was). */
export function coverageNote(c: Coverage): string | null {
  if (c.detail === 0 || isCompleteCoverage(c)) return null;
  return `Based on ${c.detail} of ${c.total} ${c.total === 1 ? 'person' : 'people'}`;
}

/** The badge on a card. A person the caller may read in full gets the rich
 *  status; everyone else gets only what presence allows. */
export function badgeFor(member: TeamSummaryMember | undefined, status: EmployeeDayStatus | undefined): MemberBadge {
  if (status) {
    switch (status.status) {
      case 'present':
      case 'late':
      case 'wfh':
        return 'in';
      case 'not_marked':
        return 'not_in_yet';
      case 'on_leave':
        return 'on_leave';
      case 'absent':
        return 'absent';
      default:
        return null; // a day off
    }
  }
  if (!member) return null;
  return member.presence === 'in' ? 'in' : member.presence === 'not_in' ? 'not_in_yet' : null;
}

/** People to list under "Not in yet today", drawn from the whole group: someone
 *  the caller reads in full counts when they simply have not clocked in (leave and
 *  absence have their own places); someone they only see presence for counts
 *  whenever they are not in. */
export function notInYet(
  people: DirectoryPerson[],
  byId: Map<string, TeamSummaryMember>,
  statusById: Map<string, EmployeeDayStatus>,
): DirectoryPerson[] {
  return people.filter((p) => {
    const member = byId.get(p.id);
    if (!member) return false;
    const status = statusById.get(p.id);
    return status ? status.status === 'not_marked' : member.presence === 'not_in';
  });
}

/** "In today" for the whole group, ignoring anyone on a day off. */
export function presenceCounts(members: { presence: Presence }[]): { inCount: number; working: number } {
  const working = members.filter((m) => m.presence !== 'day_off');
  return { inCount: working.filter((m) => m.presence === 'in').length, working: working.length };
}

// --- search and sort ---------------------------------------------------------------------

export type SortKey = 'name' | 'name_desc' | 'department' | 'presence';

export const SORT_LABEL: Record<SortKey, string> = {
  name: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  department: 'Department',
  presence: 'Not in first',
};

/** Below this many people, finding someone needs no help, so no search or sort is offered. */
export const SEARCH_THRESHOLD = 6;

export interface Labels {
  designation: (p: DirectoryPerson) => string;
  department: (p: DirectoryPerson) => string;
}

export function matchesSearch(p: DirectoryPerson, query: string, labels: Labels): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [fullName(p), p.work_email, p.employee_code, labels.designation(p), labels.department(p)].some((v) =>
    v.toLowerCase().includes(q),
  );
}

export function sortPeople(
  people: DirectoryPerson[],
  key: SortKey,
  labels: Labels,
  byId: Map<string, TeamSummaryMember>,
): DirectoryPerson[] {
  const byName = (a: DirectoryPerson, b: DirectoryPerson) => fullName(a).localeCompare(fullName(b));
  const rank = (p: DirectoryPerson) => (byId.get(p.id)?.presence === 'not_in' ? 0 : 1);
  const compare: Record<SortKey, (a: DirectoryPerson, b: DirectoryPerson) => number> = {
    name: byName,
    name_desc: (a, b) => byName(b, a),
    department: (a, b) => labels.department(a).localeCompare(labels.department(b)) || byName(a, b),
    presence: (a, b) => rank(a) - rank(b) || byName(a, b),
  };
  return [...people].sort(compare[key]);
}
