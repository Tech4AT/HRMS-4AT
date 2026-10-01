'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { MailIcon } from '@/components/icons';
import { EMPLOYMENT_TYPES, fmtDate, STATUS_LABELS, type EmployeeStatus } from '@/lib/admin/orgApi';
import type { MyTeamData } from '@/lib/api/myTeam';
import { fullName, type DirectoryPerson } from '@/lib/team/groups';
import { MemberAttendanceDetail } from '@/components/attendance/MemberAttendanceDetail';
import { Avatar, BADGE, type MemberBadge } from './MemberCard';

type DetailTab = 'profile' | 'job' | 'attendance';

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-900 mt-1 break-words">{value || '—'}</p>
    </div>
  );
}

/** A colleague's details, opened from a My Team card. Everything shown is part
 *  of the company directory every signed-in user can already see. Personal
 *  details (personal email, phone, date of birth, address) are deliberately not
 *  here: they stay on the profile, for the person and HR. */
export function MemberDetails({
  person,
  data,
  badge,
  canOpenProfile,
  canViewAttendance,
  onClose,
}: {
  person: DirectoryPerson;
  data: MyTeamData;
  badge: MemberBadge;
  /** Whether to offer the full profile page (it enforces access itself). */
  canOpenProfile: boolean;
  /** Whether the viewer may read this person's attendance in full (check-in/out
   *  times, breaks). Decided by the backend; false hides the Attendance tab. */
  canViewAttendance: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>('profile');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = fullName(person);
  const lookup = (map: Record<string, string>, id: string | null | undefined) => (id ? map[id] : undefined);
  const manager = person.manager_id ? data.people.find((p) => p.id === person.manager_id) : undefined;
  const employmentType = EMPLOYMENT_TYPES.find((t) => t.value === person.employment_type)?.label ?? person.employment_type;
  const b = badge ? BADGE[badge] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24 bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${name}`}
        className={`bg-white rounded-lg shadow-xl w-full overflow-hidden ${tab === 'attendance' ? 'max-w-3xl' : 'max-w-xl'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 bg-slate-100 border-b border-slate-200">
          <Avatar person={person} size="md" />
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 truncate">{name}</h2>
            {b ? <span className={`shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5 ${b.cls}`}>{b.label}</span> : null}
          </div>
          {canOpenProfile ? (
            <Link
              href={`/org/${person.id}`}
              title="Open full profile"
              aria-label={`Open ${name}'s full profile`}
              className="text-slate-500 hover:text-indigo-600 text-lg leading-none px-1"
            >
              &#8599;
            </Link>
          ) : null}
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-slate-900 text-2xl leading-none px-1"
          >
            &times;
          </button>
        </div>

        <div className="flex gap-6 px-5 border-b border-slate-200" role="tablist">
          {[
            ['profile', 'Profile'],
            ['job', 'Job'],
            ...(canViewAttendance ? [['attendance', 'Attendance']] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id as DetailTab)}
              className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'profile' ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Contact Details</h3>
                <div className="flex items-center gap-2 text-sm text-slate-800 min-w-0">
                  <MailIcon className="w-4 h-4 text-slate-400 shrink-0" />
                  <a href={`mailto:${person.work_email}`} className="hover:text-indigo-700 hover:underline truncate">
                    {person.work_email}
                  </a>
                </div>
              </div>
              <Item label="Location" value={lookup(data.locations, person.location_id)} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <Item label="Job title" value={lookup(data.designations, person.designation_id)} />
                <Item label="Department" value={lookup(data.departments, person.department_id)} />
                <Item label="Business unit" value={lookup(data.businessUnits, person.business_unit_id)} />
              </div>
            </div>
) : tab === 'attendance' && canViewAttendance ? (
            <MemberAttendanceDetail employeeId={person.id} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Item label="Employee code" value={person.employee_code} />
              <Item label="Status" value={STATUS_LABELS[person.status as EmployeeStatus] ?? person.status} />
              <Item label="Reporting manager" value={manager ? fullName(manager) : 'No manager'} />
              <Item label="Employment type" value={employmentType} />
              <Item label="Date of joining" value={person.date_of_joining ? fmtDate(person.date_of_joining) : null} />
              <Item label="Legal entity" value={lookup(data.legalEntities, person.legal_entity_id)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
