'use client';

import { avatarGradient, initialsOf } from '@/lib/avatar';
import { fullName, type DirectoryPerson } from '@/lib/team/groups';
import type { MemberBadge } from '@/lib/team/view';

export type { MemberBadge };

export const BADGE: Record<Exclude<MemberBadge, null>, { label: string; cls: string }> = {
  in: { label: 'IN', cls: 'bg-emerald-100 text-emerald-700' },
  not_in_yet: { label: 'NOT IN YET', cls: 'bg-sky-100 text-sky-700' },
  on_leave: { label: 'ON LEAVE', cls: 'bg-violet-100 text-violet-700' },
  absent: { label: 'ABSENT', cls: 'bg-red-100 text-red-700' },
};

export function Avatar({ person, size = 'md' }: { person: DirectoryPerson; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'w-7 h-7 text-[10px]', md: 'w-10 h-10 text-xs', lg: 'w-14 h-14 text-base' }[size];
  return (
    <div
      className={`${dims} rounded-full bg-gradient-to-br ${avatarGradient(person.id)} flex items-center justify-center text-white font-bold shrink-0`}
    >
      {initialsOf(person.first_name, person.last_name)}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <p className="text-xs text-gray-500 mt-1 truncate" title={value ?? undefined}>
      {label}: <span className="text-gray-700">{value || '—'}</span>
    </p>
  );
}

/** One person: name, title, where they sit and how to reach them. Mobile
 *  numbers are personal data and are deliberately not part of the directory. */
export function MemberCard({
  person,
  designation,
  department,
  location,
  badge,
  onOpen,
}: {
  person: DirectoryPerson;
  designation?: string;
  department?: string;
  location?: string;
  badge: MemberBadge;
  /** Open this person's details panel. */
  onOpen: () => void;
}) {
  const b = badge ? BADGE[badge] : null;
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <Avatar person={person} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-sm font-semibold text-slate-900 truncate">
                <button onClick={onOpen} className="hover:text-indigo-700 hover:underline text-left truncate max-w-full">
                  {fullName(person)}
                </button>
              </h3>
            </div>
            {b ? (
              <span className={`shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5 ${b.cls}`}>{b.label}</span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{designation || '—'}</p>
          <div className="mt-2">
            <Line label="Location" value={location} />
            <Line label="Department" value={department} />
            <Line label="Email" value={person.work_email} />
          </div>
        </div>
      </div>
    </div>
  );
}
