'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import { ApiError } from '@/lib/admin/api';
import {
  GENDERS,
  STATUS_LABELS,
  fmtDate,
  fullName,
  orgApi,
  type EmployeeRow,
  type PersonalDetails,
} from '@/lib/admin/orgApi';
import type { Lookups, Named } from '@/components/admin/org/useOrgData';
import { EmployeeDrawer } from '@/components/admin/org/EmployeeDrawer';
import { Badge, Notice } from '@/components/admin/ui';

const AVATAR_COLORS = [
  'from-slate-600 to-slate-800',
  'from-rose-600 to-pink-600',
  'from-blue-600 to-indigo-600',
  'from-fuchsia-600 to-purple-600',
  'from-emerald-600 to-teal-600',
  'from-amber-600 to-orange-600',
  'from-cyan-600 to-blue-600',
  'from-indigo-600 to-violet-600',
  'from-teal-600 to-emerald-600',
  'from-pink-600 to-rose-600',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initialsOf(e: EmployeeRow): string {
  return `${e.first_name?.[0] ?? ''}${e.last_name?.[0] ?? ''}`.toUpperCase() || '—';
}

class FetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new FetchError(body?.error?.message || `Request to ${url} failed`, res.status);
  }
  return body.data as T;
}

async function fetchNamed(url: string): Promise<Named[]> {
  const items = await fetchJson<{ id: number | string; name: string }[]>(url);
  return items.map((e) => ({ id: String(e.id), name: e.name }));
}

const EMPTY_LOOKUPS: Lookups = {
  departments: [],
  designations: [],
  locations: [],
  legalEntities: [],
  businessUnits: [],
  costCenters: [],
};

type TabId = 'job' | 'personal' | 'documents';

const TABS: { id: TabId; label: string }[] = [
  { id: 'job', label: 'Job' },
  { id: 'personal', label: 'Personal' },
  { id: 'documents', label: 'Documents' },
];

function genderLabel(value: string): string {
  return GENDERS.find((g) => g.value === value)?.label ?? (value || 'Not recorded');
}

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { hasPermission } = useAuth();
  const canReadPersonal = hasPermission('employees.personal.read');
  const canWrite = hasPermission('employees.write');

  const [tab, setTab] = useState<TabId>('job');
  const [employee, setEmployee] = useState<EmployeeRow | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [lookups, setLookups] = useState<Lookups>(EMPTY_LOOKUPS);
  const [personal, setPersonal] = useState<PersonalDetails | null>(null);
  const [personalDenied, setPersonalDenied] = useState(!canReadPersonal);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status: number | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [record, directory, departments, designations, locations, legalEntities, businessUnits, costCenters] =
          await Promise.all([
            fetchJson<EmployeeRow>(`/api/employees/${id}`),
            fetchJson<EmployeeRow[]>('/api/employees'),
            fetchNamed('/api/departments'),
            fetchNamed('/api/designations'),
            fetchNamed('/api/locations'),
            fetchNamed('/api/legal-entities'),
            fetchNamed('/api/business-units'),
            fetchNamed('/api/cost-centers'),
          ]);
        if (cancelled) return;
        setEmployee(record);
        setEmployees(directory);
        setLookups({ departments, designations, locations, legalEntities, businessUnits, costCenters });
        if (canReadPersonal) {
          try {
            const details = await orgApi.getPersonal(id);
            if (!cancelled) {
              setPersonal(details);
              setPersonalDenied(false);
            }
          } catch (e) {
            if (!cancelled && e instanceof ApiError && e.status === 403) setPersonalDenied(true);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError({
            message: e instanceof Error ? e.message : 'Failed to load this profile',
            status: e instanceof FetchError ? e.status : null,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, canReadPersonal]);

  const names = useMemo(() => {
    const map = (items: Named[]) => Object.fromEntries(items.map((i) => [i.id, i.name]));
    return {
      departments: map(lookups.departments),
      designations: map(lookups.designations),
      locations: map(lookups.locations),
      legalEntities: map(lookups.legalEntities),
      businessUnits: map(lookups.businessUnits),
      costCenters: map(lookups.costCenters),
    };
  }, [lookups]);

  const byId = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const manager = employee?.manager_id ? byId[employee.manager_id] ?? null : null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-8 space-y-4 max-w-4xl mx-auto">
        <Link href="/org?tab=directory" className="inline-block text-sm font-semibold text-purple-700 hover:underline">
          ← Back to directory
        </Link>

        {notice && (
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <Notice tone="success">{notice}</Notice>
            </div>
            <button className="text-sm text-gray-500 hover:text-gray-900 shrink-0 pt-2" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading profile…</p>
        ) : error || !employee ? (
          <Notice tone="error">
            {error?.status === 403
              ? "You don't have access to this profile."
              : error?.status === 404
                ? 'No employee found for this page.'
                : (error?.message ?? 'Failed to load this profile')}
          </Notice>
        ) : (
          <>
            {/* Header */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <span
                  className={`w-14 h-14 rounded-full bg-gradient-to-br ${colorFor(employee.id)} flex items-center justify-center text-white text-lg font-bold shrink-0`}
                >
                  {initialsOf(employee)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-slate-900 truncate">{fullName(employee) || employee.work_email}</h2>
                  <p className="text-sm text-gray-500 truncate">
                    {[employee.designation_id ? names.designations[employee.designation_id] : null,
                      employee.department_id ? names.departments[employee.department_id] : null,
                      employee.location_id ? names.locations[employee.location_id] : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {employee.status === 'active' && <Badge tone="green">{STATUS_LABELS.active}</Badge>}
                    {employee.status === 'on_leave' && <Badge tone="amber">{STATUS_LABELS.on_leave}</Badge>}
                    {employee.status === 'exited' && <Badge tone="red">{STATUS_LABELS.exited}</Badge>}
                    <span className="text-xs text-gray-400">{employee.employee_code}</span>
                  </div>
                </div>
                {canWrite && (
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-2 text-xs font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shrink-0"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex gap-5 px-5 border-b border-gray-200 overflow-x-auto" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`px-1 py-3 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                      tab === t.id
                        ? 'border-purple-600 text-purple-700'
                        : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5 sm:p-6">
                {tab === 'job' && (
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                    <JobField label="Work email" value={employee.work_email || '—'} />
                    <JobField label="Employee code" value={employee.employee_code} />
                    <JobField
                      label="Job title"
                      value={employee.designation_id ? (names.designations[employee.designation_id] ?? '—') : '—'}
                    />
                    <JobField
                      label="Department"
                      value={employee.department_id ? (names.departments[employee.department_id] ?? '—') : '—'}
                    />
                    <JobField
                      label="Location"
                      value={employee.location_id ? (names.locations[employee.location_id] ?? '—') : '—'}
                    />
                    <JobField label="Reports to" value={manager ? fullName(manager) : employee.manager_id ? '—' : 'No manager'} />
                    <JobField
                      label="Business unit"
                      value={employee.business_unit_id ? (names.businessUnits[employee.business_unit_id] ?? '—') : '—'}
                    />
                    <JobField
                      label="Cost centre"
                      value={employee.cost_center_id ? (names.costCenters[employee.cost_center_id] ?? '—') : '—'}
                    />
                    <JobField
                      label="Legal entity"
                      value={employee.legal_entity_id ? (names.legalEntities[employee.legal_entity_id] ?? '—') : '—'}
                    />
                    <JobField label="Date of joining" value={fmtDate(employee.date_of_joining)} />
                    {employee.status === 'exited' && (
                      <JobField label="Last working day" value={fmtDate(employee.date_of_exit)} />
                    )}
                  </dl>
                )}

                {tab === 'personal' &&
                  (personalDenied || !canReadPersonal ? (
                    <Notice tone="info">Personal details are held back from the ordinary directory. Only people with permission can see them.</Notice>
                  ) : !personal ? (
                    <p className="text-sm text-gray-500">Loading personal details…</p>
                  ) : (
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                      <JobField label="Personal email" value={personal.personal_email || '—'} />
                      <JobField label="Phone" value={personal.phone || '—'} />
                      <JobField label="Date of birth" value={fmtDate(personal.dob)} />
                      <JobField label="Gender" value={genderLabel(personal.gender)} />
                      {personal.exit_reason && <JobField label="Reason for leaving" value={personal.exit_reason} />}
                    </dl>
                  ))}

                {tab === 'documents' && (
                  <div className="text-sm text-gray-500">
                    <p className="font-semibold text-gray-700">No documents here yet.</p>
                    <p className="mt-1">Real document uploads for this person arrive with the profile-tabs build (EMP-B6).</p>
                  </div>
                )}
              </div>
            </div>

            {editing && (
              <EmployeeDrawer
                key={employee.id}
                employee={employee}
                employees={employees}
                lookups={lookups}
                canWrite={canWrite}
                onClose={() => setEditing(false)}
                onSaved={async (saved, message) => {
                  setEmployee(saved);
                  setNotice(message);
                  try {
                    setEmployees(await fetchJson<EmployeeRow[]>('/api/employees'));
                  } catch {
                    // Manager names keep their last values; the profile itself is fresh.
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function JobField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-gray-900 break-words">{value}</dd>
    </div>
  );
}
