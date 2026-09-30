'use client';

import type { TeamSummaryMember } from '@/lib/api/teamAttendance';
import type { EmployeeDayStatus } from '@/lib/attendance/dashboard';
import { fullName, type DirectoryPerson } from '@/lib/team/groups';
import { coverageNote, notInYet, presenceCounts, type Coverage } from '@/lib/team/view';
import { Avatar } from './MemberCard';

export type StatusFilter = 'on_time' | 'late' | 'wfh' | 'not_in';

export const FILTER_LABEL: Record<StatusFilter, string> = {
  on_time: 'On time today',
  late: 'Late arrivals today',
  wfh: 'Working from home today',
  not_in: 'Not in yet today',
};

interface Props {
  /** Everyone in the group. */
  people: DirectoryPerson[];
  /** The backend's per-person level and presence, for the same group. */
  byId: Map<string, TeamSummaryMember>;
  /** Today's full status, for the people the caller may read in full. */
  statusById: Map<string, EmployeeDayStatus>;
  coverage: Coverage;
  active: StatusFilter | null;
  onFilter: (next: StatusFilter | null) => void;
}

function StatCard({
  label,
  value,
  accent,
  onView,
  selected,
}: {
  label: string;
  value: number;
  accent: string;
  onView: () => void;
  selected: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 border-l-4 ${accent} p-4 shadow-sm ${selected ? 'ring-2 ring-indigo-200' : ''}`}>
      <p className="text-sm text-slate-700 mb-2">{label}</p>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        <button onClick={onView} className="text-xs font-medium text-blue-600 hover:text-blue-700">
          {selected ? 'Show everyone' : 'View Employees'}
        </button>
      </div>
    </div>
  );
}

function NotInYetCard({
  people,
  selected,
  onToggle,
}: {
  people: DirectoryPerson[];
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-200 p-5 shadow-sm ${selected ? 'ring-2 ring-indigo-200' : ''}`}>
      <h2 className="text-base font-bold text-slate-900 mb-3">Not in yet today</h2>
      {people.length === 0 ? (
        <p className="text-sm text-gray-500">Everyone has checked in.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {people.slice(0, 6).map((person) => (
            <div key={person.id} className="flex flex-col items-center text-center w-16" title={fullName(person)}>
              <Avatar person={person} />
              <span className="text-xs text-gray-600 mt-1.5 truncate w-full">{person.first_name}</span>
            </div>
          ))}
          {people.length > 6 || selected ? (
            <button onClick={onToggle} className="self-center text-xs font-medium text-blue-600 hover:text-blue-700">
              {selected ? 'Show everyone' : `+${people.length - 6} more`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Today at a glance for one group.
 *
 *  Who is in and who is not comes from everyone in the group. Leave, on time,
 *  late and working from home only exist for the people the caller may read in
 *  full, so when that is not everyone those figures say how many people they are
 *  based on; when it is nobody they are not shown at all. */
export function TeamStatus({ people, byId, statusById, coverage, active, onFilter }: Props) {
  const notIn = notInYet(people, byId, statusById);
  const note = coverageNote(coverage);

  // Nobody the caller may read in full: presence is all there is to show.
  if (coverage.detail === 0) {
    const { inCount, working } = presenceCounts([...byId.values()]);
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 mb-3">In today</h2>
          <p className="text-2xl font-bold text-slate-900">
            {working === 0 ? 'Day off' : `${inCount} of ${working}`}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            You can see who is in. Leave and timing details are limited to managers and HR.
          </p>
        </div>
        <NotInYetCard
          people={notIn}
          selected={active === 'not_in'}
          onToggle={() => onFilter(active === 'not_in' ? null : 'not_in')}
        />
      </div>
    );
  }

  const detail = people
    .map((person) => ({ person, s: statusById.get(person.id) }))
    .filter((x): x is { person: DirectoryPerson; s: EmployeeDayStatus } => Boolean(x.s));
  const onLeave = detail.filter((x) => x.s.status === 'on_leave');
  const count = (k: EmployeeDayStatus['status']) => detail.filter((x) => x.s.status === k).length;
  const toggle = (f: StatusFilter) => onFilter(active === f ? null : f);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 mb-3">Who is on leave today</h2>
          {onLeave.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              No employee is on leave today.
            </div>
          ) : (
            <ul className="space-y-2">
              {onLeave.map(({ person, s }) => (
                <li key={person.id} className="flex items-center gap-3">
                  <Avatar person={person} size="sm" />
                  <span className="text-sm text-slate-800 truncate">{fullName(person)}</span>
                  {s.leaveType ? <span className="text-xs text-slate-500 shrink-0">· {s.leaveType}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {note ? <p className="text-xs text-slate-500 mt-3">{note}</p> : null}
        </div>

        <NotInYetCard
          people={notIn}
          selected={active === 'not_in'}
          onToggle={() => onFilter(active === 'not_in' ? null : 'not_in')}
        />
      </div>

      <div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Employees On Time today"
            value={count('present')}
            accent="border-teal-400"
            selected={active === 'on_time'}
            onView={() => toggle('on_time')}
          />
          <StatCard
            label="Late Arrivals today"
            value={count('late')}
            accent="border-violet-400"
            selected={active === 'late'}
            onView={() => toggle('late')}
          />
          <StatCard
            label="Work from Home today"
            value={count('wfh')}
            accent="border-emerald-400"
            selected={active === 'wfh'}
            onView={() => toggle('wfh')}
          />
        </div>
        {note ? <p className="text-xs text-slate-500 mt-2">{note}</p> : null}
      </div>
    </div>
  );
}
