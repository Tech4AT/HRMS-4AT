'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/admin/api';
import { Badge, Notice } from '@/components/admin/ui';
import {
  BriefcaseIcon,
  IdCardIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
} from '@/components/icons';
import { useAuth } from '@/lib/auth/useAuth';
import { employee360Api, type Employee360 as Employee360Data } from '@/lib/api/employee360';
import { AboutTab } from './AboutTab';
import { AddressCard } from './AddressCard';
import { ContactCard } from './ContactCard';
import { EducationRecordCards } from '@/components/documents/EducationRecordCards';
import { IdentityDocumentCards } from '@/components/documents/IdentityDocumentCards';
import { MyDocumentsList } from '@/components/documents/MyDocumentsList';
import { EmergencyContactsCard } from './EmergencyContactsCard';
import { JobCard } from './JobCard';
import { PersonalDetailsCard } from './PersonalDetailsCard';

export interface ExtraTab {
  id: string;
  label: string;
  content: ReactNode;
  /** Before the built-in tabs or after them. Default: after. */
  placement?: 'start' | 'end';
}

interface Props {
  /** An employee id, or `me` for the signed-in user's own record. */
  employeeId: string;
  /** Extra tabs a route adds around the built-in Profile and Job tabs. */
  extraTabs?: ExtraTab[];
  /** Buttons in the header, e.g. HR's Edit. */
  headerActions?: ReactNode;
  /** Change this to reload the profile after something outside it changed. */
  reloadKey?: number;
  /** The tab to open first (`about`, `profile`, `job` or an extra tab's id). Default: Profile when readable, else Job. */
  defaultTab?: string;
}

const AVATAR_COLORS = [
  'from-slate-600 to-slate-800',
  'from-rose-600 to-pink-600',
  'from-blue-600 to-indigo-600',
  'from-fuchsia-600 to-purple-600',
  'from-emerald-600 to-teal-600',
  'from-amber-600 to-orange-600',
  'from-cyan-600 to-blue-600',
  'from-indigo-600 to-violet-600',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function loadErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have access to this profile.";
    if (e.status === 404) return 'No employee found for this page.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Failed to load this profile';
}

/** One employee profile for everyone. What is visible and editable comes from
 *  the backend's `access` flags, so the same component serves the person
 *  themselves, HR and managers. */
export function Employee360({ employeeId, extraTabs = [], headerActions, reloadKey = 0, defaultTab }: Props) {
  const { refreshUser } = useAuth();
  const [data, setData] = useState<Employee360Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(defaultTab ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await employee360Api.get(employeeId);
        if (cancelled) return;
        setData(profile);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(loadErrorText(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, reloadKey]);

  const onNameChanged = useCallback(() => {
    // The header, sidebar and top bar read the name from the signed-in user.
    if (data?.access.is_self) void refreshUser();
  }, [data?.access.is_self, refreshUser]);

  if (error) {
    return (
      <div className="p-4 sm:p-8">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }
  if (!data) {
    return <p className="p-4 sm:p-8 text-sm text-slate-500">Loading profile…</p>;
  }

  const { job, personal, address, emergency_contacts: contacts } = data;
  const fullName = `${data.first_name} ${data.last_name}`.trim() || data.work_email;
  const initials = `${data.first_name?.[0] ?? ''}${data.last_name?.[0] ?? ''}`.toUpperCase() || '—';

  const profileTab: ExtraTab[] =
    personal && address && contacts
      ? [
          {
            id: 'profile',
            label: 'Profile',
            content: (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                <div className="xl:col-span-2 space-y-5">
                  <PersonalDetailsCard profile={data} onChange={setData} onNameChanged={onNameChanged} />
                  <ContactCard profile={data} onChange={setData} />
                </div>
                <div className="space-y-5">
                  <AddressCard profile={data} address={address} onChange={setData} />
                  <EmergencyContactsCard profile={data} contacts={contacts} onChange={setData} />
                </div>
              </div>
            ),
          },
        ]
      : [];

  const numericId = typeof data.id === 'string' ? parseInt(data.id, 10) : data.id;
  const documentsTab: ExtraTab = {
    id: 'documents',
    label: 'Documents',
    content: (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-slate-900 mb-1">Identity Documents</h3>
          <p className="text-xs text-gray-500 mb-4">Aadhaar, PAN and other government IDs. Visible only to the employee, HR, and Finance.</p>
          <IdentityDocumentCards employeeId={numericId} readOnly={!data.access.is_self} />
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-slate-900 mb-1">Degrees &amp; Certificates</h3>
          <p className="text-xs text-gray-500 mb-4">Education details with a certificate for each. Visible only to the employee and HR.</p>
          <EducationRecordCards employeeId={numericId} readOnly={!data.access.is_self} />
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="text-base font-bold text-slate-900 mb-1">Documents</h3>
          <p className="text-xs text-gray-500 mb-4">Everything submitted, plus the signed offer letter.</p>
          <MyDocumentsList employeeId={numericId} readOnly={!data.access.is_self} />
        </div>
      </div>
    ),
  };

  const jobTab: ExtraTab = {
    id: 'job',
    label: 'Job',
    content: <JobCard job={job} />,
  };

  const aboutTab: ExtraTab = {
    id: 'about',
    label: 'About',
    content: <AboutTab profile={data} onChange={setData} />,
  };

  const tabs: ExtraTab[] = [
    aboutTab,
    ...extraTabs.filter((t) => t.placement === 'start'),
    ...profileTab,
    jobTab,
    documentsTab,
    ...extraTabs.filter((t) => t.placement !== 'start'),
  ];
  const activeId = tabs.some((t) => t.id === tab) ? tab : (profileTab[0]?.id ?? jobTab.id);
  const active = tabs.find((t) => t.id === activeId) ?? jobTab;

  const statusBadge =
    data.status === 'active' ? (
      <Badge tone="green">Active</Badge>
    ) : data.status === 'on_leave' ? (
      <Badge tone="amber">On leave</Badge>
    ) : data.status === 'exited' ? (
      <Badge tone="red">Left</Badge>
    ) : (
      <Badge tone="gray">{data.status}</Badge>
    );

  return (
    <div className="bg-slate-50 font-['Inter']">
      <div className="bg-white border-b border-slate-200">
        <div className="px-4 sm:px-8 pt-6 pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 min-w-0">
              <div
                className={`w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-white shadow-md bg-gradient-to-br ${colorFor(data.id)} flex items-center justify-center text-white text-3xl font-bold shrink-0`}
              >
                {initials}
              </div>
              <div className="pb-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 break-words">{fullName}</h1>
                  {statusBadge}
                </div>
                <p className="text-slate-500 flex items-center gap-1.5 mt-1 text-sm">
                  <BriefcaseIcon className="w-4 h-4" />
                  {job.designation_name ?? '—'}
                </p>
              </div>
            </div>
            {headerActions ? <div className="flex items-center gap-3 shrink-0">{headerActions}</div> : null}
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 mt-6 text-sm text-slate-600">
            <span className="flex items-center gap-2">
              <MailIcon className="w-4 h-4 text-slate-400" />
              {data.work_email}
            </span>
            {personal?.phone ? (
              <span className="flex items-center gap-2">
                <PhoneIcon className="w-4 h-4 text-slate-400" />
                {personal.phone}
              </span>
            ) : null}
            {job.location_name ? (
              <span className="flex items-center gap-2">
                <MapPinIcon className="w-4 h-4 text-slate-400" />
                {job.location_name}
              </span>
            ) : null}
            <span className="flex items-center gap-2">
              <IdCardIcon className="w-4 h-4 text-slate-400" />
              {data.employee_code}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-16 gap-y-3 mt-5">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Department</p>
              <p className="text-sm font-semibold text-slate-900 mt-1">{job.department_name ?? '—'}</p>
            </div>
            {job.manager ? (
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Reporting Manager</p>
                <p className="text-sm font-semibold text-blue-600 mt-1">{job.manager.name}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="px-4 sm:px-8 border-t border-slate-100">
          <div className="flex gap-8 overflow-x-auto" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeId === t.id}
                onClick={() => setTab(t.id)}
                className={`py-4 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  activeId === t.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-8">{active.content}</div>
    </div>
  );
}
