'use client';

import { useEffect, useMemo, useState } from 'react';
import { MemberCard } from '@/components/team/MemberCard';
import { MemberDetails } from '@/components/team/MemberDetails';
import { FILTER_LABEL, TeamStatus, type StatusFilter } from '@/components/team/TeamStatus';
import { TeamCalendar } from '@/components/team/TeamCalendar';
import { myTeamApi, type MyTeamData } from '@/lib/api/myTeam';
import type { TeamGroup, TeamSummaryMember } from '@/lib/api/teamAttendance';
import { statusFor, type DailyStatus, type EmployeeDayStatus } from '@/lib/attendance/dashboard';
import { useAuth } from '@/lib/auth/useAuth';
import type { DirectoryPerson } from '@/lib/team/groups';
import { monthKeyOf, useTeamSummary } from '@/lib/team/useTeamSummary';
import {
  badgeFor,
  coverageNote,
  matchesSearch,
  notInYet,
  SEARCH_THRESHOLD,
  SORT_LABEL,
  sortPeople,
  type Labels,
  type SortKey,
} from '@/lib/team/view';

const TABS: { id: TeamGroup; label: string }[] = [
  { id: 'direct', label: 'Direct Reports' },
  { id: 'indirect', label: 'Indirect Reports' },
  { id: 'peers', label: 'Peers' },
];

// The stat-card filters match on today's full status; "not in" is decided by `notInYet`.
const FILTER_STATUS: Record<Exclude<StatusFilter, 'not_in'>, DailyStatus> = {
  on_time: 'present',
  late: 'late',
  wfh: 'wfh',
};

function emptyText(group: TeamGroup, hasManager: boolean): string {
  if (group === 'direct') return 'No one reports to you.';
  if (group === 'indirect') return "You don't have any indirect reports.";
  return hasManager
    ? 'No one else reports to your manager.'
    : "You don't have a reporting manager yet, so there are no peers to show.";
}

/** My Team > Summary: the people who report to you (directly or further down),
 *  your peers, and how today and the month look for them.
 *
 *  Everything on the page for one group comes from a single backend response:
 *  who is in the group, what may be shown about each person, and how many people
 *  that covers. The backend reuses the access-control rules, so managers see full
 *  detail for the people they manage and everyone else sees only who is in. */
export default function TeamPage() {
  const [data, setData] = useState<MyTeamData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TeamGroup>('direct');
  const [filter, setFilter] = useState<StatusFilter | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [selected, setSelected] = useState<DirectoryPerson | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const { hasOrgScope } = useAuth();

  useEffect(() => {
    let cancelled = false;
    myTeamApi
      .load()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Could not load your team'));
    return () => {
      cancelled = true;
    };
  }, []);

  const { summary, monthRows, error: summaryError } = useTeamSummary(tab, monthKeyOf(month));

  const peopleById = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);
  const byId = useMemo(
    () => new Map<string, TeamSummaryMember>((summary?.members ?? []).map((m) => [m.employee_id, m])),
    [summary],
  );

  // Today's full status, only for the people the backend let us read in full.
  const statusById = useMemo(() => {
    const map = new Map<string, EmployeeDayStatus>();
    for (const row of summary?.rows ?? []) {
      if (row.attendance_date === summary?.date) map.set(row.employee_id, statusFor(row));
    }
    return map;
  }, [summary]);

  const labels: Labels | null = useMemo(
    () =>
      data && {
        designation: (p) => (p.designation_id ? (data.designations[p.designation_id] ?? '') : ''),
        department: (p) => (p.department_id ? (data.departments[p.department_id] ?? '') : ''),
      },
    [data],
  );

  // The group, exactly as the backend defined it.
  const people = useMemo(
    () => (summary?.members ?? []).map((m) => peopleById.get(m.employee_id)).filter((p): p is DirectoryPerson => Boolean(p)),
    [summary, peopleById],
  );
  const detailPeople = useMemo(
    () => people.filter((p) => byId.get(p.id)?.level === 'detail'),
    [people, byId],
  );

  const shown = useMemo(() => {
    if (!labels) return [];
    const notInIds = new Set(notInYet(people, byId, statusById).map((p) => p.id));
    const matchesFilter = (p: DirectoryPerson) => {
      if (!filter) return true;
      if (filter === 'not_in') return notInIds.has(p.id);
      return statusById.get(p.id)?.status === FILTER_STATUS[filter];
    };
    const visible = people.filter(matchesFilter).filter((p) => matchesSearch(p, search, labels));
    return sortPeople(visible, sort, labels, byId);
  }, [people, filter, statusById, search, sort, labels, byId]);

  const switchTab = (next: TeamGroup) => {
    setTab(next);
    setFilter(null);
    setSearch('');
  };

  if (loadError) return <div className="p-6 text-sm text-red-600">{loadError}</div>;
  if (!data || !labels) return <div className="p-6 text-sm text-slate-500">Loading your team…</div>;

  const note = summary ? coverageNote(summary.coverage) : null;
  const searchable = people.length > SEARCH_THRESHOLD;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-8">
        <div className="flex gap-5">
          <span className="relative py-4 text-xs font-semibold tracking-wide text-blue-600 uppercase">
            Summary
            <span className="absolute -bottom-px left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[5px] border-b-blue-600" />
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white" role="tablist">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => switchTab(t.id)}
                className={`px-5 py-2.5 text-sm font-medium transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${
                  tab === t.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {summaryError && !summary ? <p className="text-sm text-red-600">{summaryError}</p> : null}
        {!summary && !summaryError ? <p className="text-sm text-slate-500">Loading…</p> : null}

        {summary ? (
          <>
            {people.length > 0 ? (
              <>
                <TeamStatus
                  people={people}
                  byId={byId}
                  statusById={statusById}
                  coverage={summary.coverage}
                  active={filter}
                  onFilter={setFilter}
                />
                {summary.coverage.detail > 0 ? (
                  <TeamCalendar
                    month={month}
                    onShift={(delta) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))}
                    members={detailPeople}
                    rows={monthRows}
                    today={summary.date}
                    note={note}
                  />
                ) : null}
              </>
            ) : null}

            <div>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <h2 className="text-base font-bold text-slate-900">
                  {TABS.find((t) => t.id === tab)?.label} ({people.length})
                </h2>
                {filter ? (
                  <span className="flex items-center gap-2 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-full px-3 py-1">
                    {FILTER_LABEL[filter]}: {shown.length}
                    <button onClick={() => setFilter(null)} className="text-indigo-500 hover:text-indigo-800" aria-label="Clear filter">
                      ×
                    </button>
                  </span>
                ) : null}
                {searchable ? (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name, title or department"
                      aria-label="Search this group"
                      className="w-60 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                    />
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as SortKey)}
                      aria-label="Sort this group"
                      className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                    >
                      {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                        <option key={k} value={k}>
                          {SORT_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              {people.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-slate-500">
                  {emptyText(tab, summary.has_manager)}
                </div>
              ) : shown.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-slate-500">
                  {filter && !search.trim() ? `No one in this group: ${FILTER_LABEL[filter].toLowerCase()}.` : 'No one matches.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {shown.map((p) => (
                    <MemberCard
                      key={p.id}
                      person={p}
                      designation={labels.designation(p)}
                      department={labels.department(p)}
                      location={p.location_id ? data.locations[p.location_id] : undefined}
                      badge={badgeFor(byId.get(p.id), statusById.get(p.id))}
                      onOpen={() => setSelected(p)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      {selected ? (
        <MemberDetails
          person={selected}
          data={data}
          badge={badgeFor(byId.get(selected.id), statusById.get(selected.id))}
          // A manager may open a direct report's profile, HR anyone's; the page itself enforces access.
          canOpenProfile={hasOrgScope() || tab === 'direct'}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
