'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import {
  onboardingApi,
  OnboardingApiError,
  OnboardingRecordListItem,
  OnboardingTemplate,
  OnboardingStage,
  TaskCategory,
  TaskOwner,
  CreateNewHireInput,
  TemplateInput,
  EmploymentType,
  OfferLetterTemplate,
  OfferLetterTemplateInput,
  STAGE_LABEL,
  STAGE_COLOR,
  OWNER_LABEL,
  OFFER_STATUS_LABEL,
  OFFER_STATUS_COLOR,
  offerNextAction,
  formatDate,
  AccessArea,
  AccessGrant,
} from '@/lib/api/onboarding';
import { PlusIcon, FileTextIcon } from '@/components/icons';

interface NamedEntity {
  id: number;
  name: string;
}

interface EmployeeLookupItem {
  id: number;
  name: string;
  workEmail: string;
  employeeCode: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json();
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message || `Request to ${url} failed`);
  }
  return body.data as T;
}

const STAGE_FILTERS: { value: OnboardingStage | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'preboarding', label: 'Preboarding' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'completed', label: 'Completed' },
];

export default function OnboardingPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const isHrAdmin = user?.role === 'superadmin';
  const hasAccess = !!user && (user.role === 'admin' || user.role === 'superadmin');
  const permissionLoading = authLoading;

  useEffect(() => {
    if (!authLoading && !hasAccess) {
      router.push('/');
    }
  }, [authLoading, hasAccess, router]);

  const [tab, setTab] = useState<'records' | 'templates' | 'offerLetterTemplates' | 'access'>('records');
  const [records, setRecords] = useState<OnboardingRecordListItem[]>([]);
  const [stageFilter, setStageFilter] = useState<OnboardingStage | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadRecords = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await onboardingApi.getRecords();
      setRecords(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load onboarding records');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (permissionLoading || !hasAccess) return;
    loadRecords();
  }, [permissionLoading, hasAccess]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false;
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;
      return (
        r.employee.name.toLowerCase().includes(term) ||
        r.employee.workEmail.toLowerCase().includes(term) ||
        r.employee.employeeCode.toLowerCase().includes(term)
      );
    });
  }, [records, stageFilter, searchTerm]);

  if (permissionLoading || !hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="bg-white border-b border-gray-200 px-4 sm:px-8">
        <div className="flex gap-5">
          <button
            onClick={() => setTab('records')}
            className={`px-1 py-3 border-b-2 font-semibold transition-colors ${
              tab === 'records' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            New Hires
          </button>
          {isHrAdmin && (
            <button
              onClick={() => setTab('templates')}
              className={`px-1 py-3 border-b-2 font-semibold transition-colors ${
                tab === 'templates' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Checklist Templates
            </button>
          )}
          {isHrAdmin && (
            <button
              onClick={() => setTab('offerLetterTemplates')}
              className={`px-1 py-3 border-b-2 font-semibold transition-colors ${
                tab === 'offerLetterTemplates' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Offer Letter Templates
            </button>
          )}
          {isHrAdmin && (
            <button
              onClick={() => setTab('access')}
              className={`px-1 py-3 border-b-2 font-semibold transition-colors ${
                tab === 'access' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Access
            </button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-8">
        {tab === 'records' && (
          <RecordsTab
            records={filteredRecords}
            isLoading={isLoading}
            error={error}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            stageFilter={stageFilter}
            onStageFilterChange={setStageFilter}
            isHrAdmin={isHrAdmin}
            onAddClick={() => setShowAddModal(true)}
          />
        )}
        {tab === 'templates' && isHrAdmin && <TemplatesTab />}
        {tab === 'offerLetterTemplates' && isHrAdmin && <OfferLetterTemplatesTab />}
        {tab === 'access' && isHrAdmin && <AccessTab />}
      </div>

      {showAddModal && (
        <AddNewHireModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            loadRecords();
          }}
        />
      )}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-purple-600 rounded-full transition-all"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

function RecordsTab({
  records,
  isLoading,
  error,
  searchTerm,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  isHrAdmin,
  onAddClick,
}: {
  records: OnboardingRecordListItem[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  stageFilter: OnboardingStage | 'all';
  onStageFilterChange: (v: OnboardingStage | 'all') => void;
  isHrAdmin: boolean;
  onAddClick: () => void;
}) {
  return (
    <>
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex-1 relative w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search by name, email, or employee code..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-4 pr-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STAGE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => onStageFilterChange(f.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                stageFilter === f.value ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-purple-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {isHrAdmin && (
          <button
            onClick={onAddClick}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700 transition-colors shrink-0"
          >
            <PlusIcon className="w-4 h-4" />
            Add New Employee
          </button>
        )}
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading onboarding records...</p>}
      {error && !isLoading && <p className="text-red-600 text-sm">{error}</p>}
      {!isLoading && !error && records.length === 0 && (
        <p className="text-gray-500 text-sm">No new hires found.</p>
      )}

      {!isLoading && !error && records.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {records.map((r) => (
            <Link
              key={r.id}
              href={`/onboarding/${r.id}`}
              className="bg-white rounded-2xl border border-gray-200 p-5 hover:shadow-lg transition-shadow block"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-bold text-gray-900 text-lg">{r.employee.name}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${STAGE_COLOR[r.stage]}`}>
                  {STAGE_LABEL[r.stage]}
                </span>
              </div>
              <p className="text-gray-500 text-sm mb-3">{r.employee.workEmail}</p>
              <p className="text-gray-600 text-sm mb-1">Joining: {formatDate(r.joiningDate)}</p>
              {r.offerLetter && (
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${OFFER_STATUS_COLOR[r.offerLetter.status]}`}>
                    {OFFER_STATUS_LABEL[r.offerLetter.status]}
                  </span>
                  <span className="text-[11px] text-gray-400">{offerNextAction(r.offerLetter.status)}</span>
                </div>
              )}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Checklist progress</span>
                  <span>{r.progress.completed}/{r.progress.total}</span>
                </div>
                <ProgressBar percent={r.progress.percent} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// ── Wizard configuration ──────────────────────────────────────────────────────

const WORKER_TYPE_OPTIONS = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
  { value: 'consultant', label: 'Consultant' },
];

const TIME_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
];

const PROBATION_POLICY_OPTIONS = [
  { value: 6, label: 'Probation Policy with Evaluation', duration: '6 Months' },
  { value: 3, label: 'Standard Probation', duration: '3 Months' },
  { value: 0, label: 'No Probation', duration: 'None' },
];

const NOTICE_PERIOD_OPTIONS = [
  { value: 30, label: '1 Month' },
  { value: 60, label: '2 Months' },
  { value: 90, label: '3 Months' },
  { value: 180, label: '6 Months' },
];

const WIZARD_STEPS = [
  { num: 1, label: 'BASIC DETAILS' },
  { num: 2, label: 'JOB DETAILS' },
  { num: 3, label: 'WORK DETAILS' },
  { num: 4, label: 'COMPENSATION' },
];

function WizardStepBar({ current }: { current: number }) {
  return (
    <div className="flex items-start mb-6">
      {WIZARD_STEPS.map((step, idx) => (
        <div key={step.num} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                current === step.num
                  ? 'bg-purple-600 border-purple-600 text-white'
                  : current > step.num
                  ? 'bg-purple-100 border-purple-400 text-purple-600'
                  : 'bg-white border-gray-300 text-gray-400'
              }`}
            >
              {current > step.num ? '✓' : step.num}
            </div>
            <span
              className={`mt-1 text-[10px] font-semibold tracking-wide whitespace-nowrap ${
                current === step.num ? 'text-purple-600' : current > step.num ? 'text-purple-400' : 'text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
          {idx < WIZARD_STEPS.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-2 mb-4 rounded ${
                current > step.num ? 'bg-purple-400' : 'bg-gray-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Add New Employee — 4-step wizard ─────────────────────────────────────────

function AddNewHireModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [departments, setDepartments] = useState<NamedEntity[]>([]);
  const [designations, setDesignations] = useState<NamedEntity[]>([]);
  const [locations, setLocations] = useState<NamedEntity[]>([]);
  const [legalEntities, setLegalEntities] = useState<NamedEntity[]>([]);
  const [businessUnits, setBusinessUnits] = useState<NamedEntity[]>([]);
  const [costCenters, setCostCenters] = useState<NamedEntity[]>([]);
  const [employees, setEmployees] = useState<EmployeeLookupItem[]>([]);
  const [offerTemplates, setOfferTemplates] = useState<OfferLetterTemplate[]>([]);

  const [form, setForm] = useState<CreateNewHireInput>({
    firstName: '',
    lastName: '',
    workEmail: '',
    personalEmail: '',
    phone: '',
    joiningDate: '',
    basicSalary: 0,
    hra: 0,
    otherAllowances: 0,
    otherComponents: 0,
    currency: 'INR',
    employmentType: 'full_time',
    workerType: 'permanent',
    probationPeriodMonths: 6,
    noticePeriodDays: 90,
    offerLetterTemplateId: null,
    temporaryPassword: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<NamedEntity[]>('/api/departments').then(setDepartments).catch(() => {});
    fetchJson<NamedEntity[]>('/api/designations').then(setDesignations).catch(() => {});
    fetchJson<NamedEntity[]>('/api/locations').then(setLocations).catch(() => {});
    fetchJson<NamedEntity[]>('/api/legal-entities').then(setLegalEntities).catch(() => {});
    fetchJson<NamedEntity[]>('/api/business-units').then(setBusinessUnits).catch(() => {});
    fetchJson<NamedEntity[]>('/api/cost-centers').then(setCostCenters).catch(() => {});
    fetchJson<EmployeeLookupItem[]>('/api/employees/lookup').then(setEmployees).catch(() => {});
    onboardingApi
      .getOfferLetterTemplates()
      .then((templates) => {
        setOfferTemplates(templates);
        const def = templates.find((t) => t.isDefault);
        if (def) setForm((f) => ({ ...f, offerLetterTemplateId: def.id }));
      })
      .catch(() => {});
  }, []);

  const update = (patch: Partial<CreateNewHireInput>) => setForm((f) => ({ ...f, ...patch }));

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!form.firstName.trim()) return 'First name is required.';
      if (!form.lastName.trim()) return 'Last name is required.';
      if (!form.workEmail.trim()) return 'Work email is required.';
      if (!form.personalEmail?.trim()) return 'Personal email is required — it is how we reach the candidate before day 1.';
    }
    if (s === 2) {
      if (!form.joiningDate) return 'Joining date is required.';
    }
    if (s === 4) {
      const total = (form.basicSalary || 0) + (form.hra || 0) + (form.otherAllowances || 0) + (form.otherComponents || 0);
      if (total <= 0) return 'Enter at least one salary component greater than 0.';
    }
    return null;
  };

  const nextStep = () => {
    const err = validateStep(step);
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => s + 1);
  };

  const prevStep = () => { setError(null); setStep((s) => s - 1); };

  const handleSubmit = async () => {
    const err = validateStep(4);
    if (err) { setError(err); return; }
    setError(null);
    setSubmitting(true);
    try {
      await onboardingApi.createRecord(form);
      onCreated();
    } catch (e) {
      if (e instanceof OnboardingApiError && e.fields && Object.keys(e.fields).length > 0) {
        const details = Object.entries(e.fields)
          .map(([f, msgs]) => `${f.replace(/_/g, ' ')}: ${Array.isArray(msgs) ? msgs.join(', ') : msgs}`)
          .join(' · ');
        setError(details);
      } else {
        setError(e instanceof OnboardingApiError ? e.message : 'Failed to create new hire');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const selectedProbation = PROBATION_POLICY_OPTIONS.find((o) => o.value === form.probationPeriodMonths);
  const selectedNotice = NOTICE_PERIOD_OPTIONS.find((o) => o.value === form.noticePeriodDays);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">Add New Employee</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none font-light">&times;</button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-5 shrink-0">
          <WizardStepBar current={step} />
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">

          {/* ── Step 1: Basic Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="First Name *">
                  <input
                    className="wizard-input"
                    value={form.firstName}
                    onChange={(e) => update({ firstName: e.target.value })}
                    placeholder="First name"
                  />
                </Field>
                <Field label="Last Name *">
                  <input
                    className="wizard-input"
                    value={form.lastName}
                    onChange={(e) => update({ lastName: e.target.value })}
                    placeholder="Last name"
                  />
                </Field>
              </div>
              <Field label="Work Email *">
                <input
                  type="email"
                  className="wizard-input"
                  value={form.workEmail}
                  onChange={(e) => update({ workEmail: e.target.value })}
                  placeholder="work@4atconsulting.com"
                />
              </Field>
              <Field label="Personal Email *">
                <input
                  type="email"
                  className="wizard-input"
                  value={form.personalEmail ?? ''}
                  onChange={(e) => update({ personalEmail: e.target.value })}
                  placeholder="Candidate's personal email (used before day 1)"
                />
              </Field>
              <Field label="Phone">
                <input
                  className="wizard-input"
                  value={form.phone ?? ''}
                  onChange={(e) => update({ phone: e.target.value })}
                  placeholder="+91 9999 9999 99"
                />
              </Field>
            </div>
          )}

          {/* ── Step 2: Job Details ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Joining Date *">
                  <input
                    type="date"
                    className="wizard-input"
                    value={form.joiningDate}
                    onChange={(e) => update({ joiningDate: e.target.value })}
                  />
                </Field>
                <Field label="Job Title">
                  <select
                    className="wizard-input"
                    value={form.designationId ?? ''}
                    onChange={(e) => update({ designationId: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Select job title</option>
                    {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              </div>

              <Field label="Time Type">
                <select
                  className="wizard-input"
                  value={form.employmentType ?? 'full_time'}
                  onChange={(e) => update({ employmentType: e.target.value as EmploymentType })}
                >
                  {TIME_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>

              <div className="pt-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Organisational Details</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Legal Entity *">
                    <select
                      className="wizard-input"
                      value={form.legalEntityId ?? ''}
                      onChange={(e) => update({ legalEntityId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Select legal entity</option>
                      {legalEntities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Business Unit">
                    <select
                      className="wizard-input"
                      value={form.businessUnitId ?? ''}
                      onChange={(e) => update({ businessUnitId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Business Unit</option>
                      {businessUnits.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Department *">
                    <select
                      className="wizard-input"
                      value={form.departmentId ?? ''}
                      onChange={(e) => update({ departmentId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Select department</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Location *">
                    <select
                      className="wizard-input"
                      value={form.locationId ?? ''}
                      onChange={(e) => update({ locationId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Select location</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Worker Type *">
                    <select
                      className="wizard-input"
                      value={form.workerType ?? 'permanent'}
                      onChange={(e) => update({ workerType: e.target.value })}
                    >
                      {WORKER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Reporting Manager">
                    <select
                      className="wizard-input"
                      value={form.managerId ?? ''}
                      onChange={(e) => update({ managerId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Select manager</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Dotted Line Manager (optional)">
                    <select
                      className="wizard-input"
                      value={form.dottedLineManagerId ?? ''}
                      onChange={(e) => update({ dottedLineManagerId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Search employee</option>
                      {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Cost Center">
                    <select
                      className="wizard-input"
                      value={form.costCenterId ?? ''}
                      onChange={(e) => update({ costCenterId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Cost Center</option>
                      {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                </div>
              </div>

              <div className="pt-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Employment Terms</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Field label="Probation Policy *">
                      <select
                        className="wizard-input"
                        value={form.probationPeriodMonths}
                        onChange={(e) => update({ probationPeriodMonths: Number(e.target.value) })}
                      >
                        {PROBATION_POLICY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    {selectedProbation && selectedProbation.value > 0 && (
                      <p className="text-xs text-gray-500 mt-1">Duration: {selectedProbation.duration}</p>
                    )}
                  </div>
                  <div>
                    <Field label="Notice Period *">
                      <select
                        className="wizard-input"
                        value={form.noticePeriodDays}
                        onChange={(e) => update({ noticePeriodDays: Number(e.target.value) })}
                      >
                        {NOTICE_PERIOD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    {selectedNotice && (
                      <p className="text-xs text-gray-500 mt-1">Duration: {selectedNotice.label}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Work Details ── */}
          {step === 3 && (
            <div className="space-y-4">
              <Field label="Buddy (optional)">
                <select
                  className="wizard-input"
                  value={form.buddyId ?? ''}
                  onChange={(e) => update({ buddyId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Select buddy</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
              <Field label="Offer Letter Template">
                <select
                  className="wizard-input"
                  value={form.offerLetterTemplateId ?? ''}
                  onChange={(e) => update({ offerLetterTemplateId: e.target.value ? Number(e.target.value) : null })}
                >
                  {offerTemplates.length === 0 && <option value="">Default template</option>}
                  {offerTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (default)' : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Temporary Password (leave blank to auto-generate)">
                <input
                  className="wizard-input"
                  value={form.temporaryPassword ?? ''}
                  onChange={(e) => update({ temporaryPassword: e.target.value })}
                  placeholder="Auto-generated if left blank"
                />
              </Field>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <p className="text-sm font-semibold text-blue-700 mb-1">What happens next?</p>
                <ul className="list-disc list-inside space-y-1 text-xs text-blue-600">
                  <li>A draft offer letter is generated with the compensation from step 4.</li>
                  <li>The candidate receives a welcome email at their personal address.</li>
                  <li>Preboarding tasks are activated once they accept the offer.</li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Step 4: Compensation ── */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Annual figures — the offer letter is generated from these values.</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Basic Salary *">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{form.currency}</span>
                    <input
                      type="number"
                      min={0}
                      step="1000"
                      className="wizard-input pl-12"
                      value={form.basicSalary || ''}
                      onChange={(e) => update({ basicSalary: Number(e.target.value) })}
                      placeholder="e.g. 900000"
                    />
                  </div>
                </Field>
                <Field label="HRA">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{form.currency}</span>
                    <input
                      type="number"
                      min={0}
                      step="1000"
                      className="wizard-input pl-12"
                      value={form.hra || ''}
                      onChange={(e) => update({ hra: Number(e.target.value) })}
                      placeholder="e.g. 200000"
                    />
                  </div>
                </Field>
                <Field label="Other Allowances">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{form.currency}</span>
                    <input
                      type="number"
                      min={0}
                      step="1000"
                      className="wizard-input pl-12"
                      value={form.otherAllowances || ''}
                      onChange={(e) => update({ otherAllowances: Number(e.target.value) })}
                      placeholder="0"
                    />
                  </div>
                </Field>
                <Field label="Other Components">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{form.currency}</span>
                    <input
                      type="number"
                      min={0}
                      step="1000"
                      className="wizard-input pl-12"
                      value={form.otherComponents || ''}
                      onChange={(e) => update({ otherComponents: Number(e.target.value) })}
                      placeholder="0"
                    />
                  </div>
                </Field>
              </div>

              <div className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded-xl px-4 py-3">
                <span className="text-sm font-semibold text-purple-700">Total CTC (annual)</span>
                <span className="text-base font-bold text-purple-900">
                  {form.currency}{' '}
                  {(
                    (form.basicSalary || 0) +
                    (form.hra || 0) +
                    (form.otherAllowances || 0) +
                    (form.otherComponents || 0)
                  ).toLocaleString('en-IN')}
                </span>
              </div>

              <Field label="Currency">
                <input
                  className="wizard-input w-24"
                  value={form.currency ?? 'INR'}
                  onChange={(e) => update({ currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                />
              </Field>
            </div>
          )}

          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={step === 1 ? onClose : prevStep}
            className="px-5 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 4 ? (
            <button
              type="button"
              onClick={nextStep}
              className="px-6 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 transition-colors"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="px-6 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating...' : 'Create Employee & Generate Offer'}
            </button>
          )}
        </div>
      </div>

      <style jsx global>{`
        .wizard-input {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          background: #fff;
          color: #111827;
          transition: border-color 0.15s;
        }
        .wizard-input:focus {
          outline: none;
          border-color: #9333ea;
          box-shadow: 0 0 0 2px rgba(147,51,234,0.1);
        }
        .wizard-input.pl-12 {
          padding-left: 3rem;
        }
        .input {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        .input:focus {
          outline: none;
          border-color: #9333ea;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
  { value: 'preboarding', label: 'Preboarding' },
  { value: 'onboarding', label: 'Onboarding' },
];

const OWNER_OPTIONS: TaskOwner[] = ['new_hire', 'hr_admin', 'manager', 'buddy', 'it_admin'];

function TemplatesTab() {
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<OnboardingTemplate | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      setTemplates(await onboardingApi.getTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const deactivate = async (id: number) => {
    if (!confirm('Remove this template? Existing new hires keep tasks already generated from it.')) return;
    await onboardingApi.deactivateTemplate(id);
    load();
  };

  const renderGroup = (category: TaskCategory) => {
    const rows = templates.filter((t) => t.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h3 className="font-bold text-gray-900 mb-4">{category === 'preboarding' ? 'Preboarding checklist' : 'Onboarding checklist'}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No templates yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{t.title}</p>
                  <p className="text-xs text-gray-500">
                    {OWNER_LABEL[t.owner]} &middot; Day {t.offsetDays >= 0 ? '+' : ''}{t.offsetDays} &middot; {t.isRequired ? 'Required' : 'Optional'}
                    {t.requiresDocument ? ' · Needs document' : ''}
                    {t.assignee ? ` · Assigned to ${t.assignee.name}` : ''}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setEditing(t)} className="text-purple-600 text-sm font-semibold hover:underline">
                    Edit
                  </button>
                  <button onClick={() => deactivate(t.id)} className="text-red-600 text-sm font-semibold hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Add Checklist Item
        </button>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading templates...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!isLoading && !error && (
        <>
          {renderGroup('preboarding')}
          {renderGroup('onboarding')}
        </>
      )}

      {(showAdd || editing) && (
        <TemplateModal
          template={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: OnboardingTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<TemplateInput>(
    template
      ? {
          category: template.category,
          title: template.title,
          description: template.description,
          owner: template.owner,
          isRequired: template.isRequired,
          requiresDocument: template.requiresDocument,
          offsetDays: template.offsetDays,
          sortOrder: template.sortOrder,
          assigneeId: template.assigneeId,
        }
      : {
          category: 'preboarding',
          title: '',
          description: '',
          owner: 'new_hire',
          isRequired: true,
          requiresDocument: false,
          offsetDays: 0,
          sortOrder: 0,
          assigneeId: null,
        },
  );
  const employees = useEmployeeOptions();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<TemplateInput>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (template) {
        await onboardingApi.updateTemplate(template.id, form);
      } else {
        await onboardingApi.createTemplate(form);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">{template ? 'Edit checklist item' : 'Add checklist item'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Title *">
            <input className="input" value={form.title} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select className="input" value={form.category} onChange={(e) => update({ category: e.target.value as TaskCategory })}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Owner">
              <select className="input" value={form.owner} onChange={(e) => update({ owner: e.target.value as TaskOwner })}>
                {OWNER_OPTIONS.map((o) => (
                  <option key={o} value={o}>{OWNER_LABEL[o]}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Offset days from joining date">
              <input
                type="number"
                className="input"
                value={form.offsetDays}
                onChange={(e) => update({ offsetDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Sort order">
              <input
                type="number"
                className="input"
                value={form.sortOrder}
                onChange={(e) => update({ sortOrder: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Default assignee (optional)">
            <select
              className="input"
              value={form.assigneeId ?? ''}
              onChange={(e) => update({ assigneeId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No one — the owner role handles it</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeCode})</option>
              ))}
            </select>
            <span className="block text-[11px] text-gray-400 mt-1">
              e.g. your IT admin for laptop setup. They&apos;re emailed when the task is created and can mark it done.
            </span>
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.isRequired} onChange={(e) => update({ isRequired: e.target.checked })} />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.requiresDocument}
                onChange={(e) => update({ requiresDocument: e.target.checked })}
              />
              Needs document
            </label>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function useEmployeeOptions(): EmployeeLookupItem[] {
  const [employees, setEmployees] = useState<EmployeeLookupItem[]>([]);
  useEffect(() => {
    fetchJson<EmployeeLookupItem[]>('/api/employees/lookup').then(setEmployees).catch(() => setEmployees([]));
  }, []);
  return employees;
}

const ACCESS_AREA_HINT: Record<AccessArea, string> = {
  bank_details: 'e.g. your payroll person — sees account details for salary setup.',
  identity_documents: 'Aadhaar, PAN and other IDs, with the uploaded scans.',
  education: 'Degrees, certificates and marks.',
  laptop: 'IT staff who provision and configure the new hire\'s laptop.',
  work_email: 'IT staff who create and set up the new hire\'s work email account.',
  id_card: 'IT / admin staff who print and issue the new hire\'s ID card.',
};

const ACCESS_AREA_SECTION: Record<AccessArea, 'hr' | 'it'> = {
  bank_details: 'hr', identity_documents: 'hr', education: 'hr',
  laptop: 'it', work_email: 'it', id_card: 'it',
};

function AccessTab() {
  const [data, setData] = useState<{ areas: { value: AccessArea; label: string }[]; grants: AccessGrant[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [bulkITEmployee, setBulkITEmployee] = useState('');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const employees = useEmployeeOptions();

  const load = async () => {
    try {
      setData(await onboardingApi.getAccessGrants());
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to load access');
    }
  };

  useEffect(() => { load(); }, []);

  const add = async (area: AccessArea) => {
    const employeeId = adding[area];
    if (!employeeId) return;
    setBusy(true);
    setError(null);
    try {
      await onboardingApi.addAccessGrant(area, Number(employeeId));
      setAdding((a) => ({ ...a, [area]: '' }));
      await load();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to grant access');
    } finally {
      setBusy(false);
    }
  };

  const grantBulkIT = async () => {
    if (!bulkITEmployee) return;
    setBusy(true);
    setBulkMsg(null);
    setError(null);
    try {
      const result = await onboardingApi.grantBulkIT(Number(bulkITEmployee));
      const emp = employees.find((e) => String(e.id) === bulkITEmployee);
      const name = emp?.name ?? 'Person';
      if (result.granted.length > 0) {
        setBulkMsg(`Granted ${name} access to: ${result.granted.join(', ')}.${result.alreadyHad.length ? ` Already had: ${result.alreadyHad.join(', ')}.` : ''}`);
      } else {
        setBulkMsg(`${name} already has all IT access areas.`);
      }
      setBulkITEmployee('');
      await load();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to grant IT access');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (grant: AccessGrant) => {
    if (!confirm(`Remove ${grant.name}'s access to ${grant.areaDisplay.toLowerCase()}?`)) return;
    setBusy(true);
    try {
      await onboardingApi.removeAccessGrant(grant.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-sm text-gray-500">{error ?? 'Loading…'}</p>;

  const hrAreas = data.areas.filter((a) => ACCESS_AREA_SECTION[a.value] === 'hr');
  const itAreas = data.areas.filter((a) => ACCESS_AREA_SECTION[a.value] === 'it');

  const areaCard = (area: { value: AccessArea; label: string }) => {
    const grants = data.grants.filter((g) => g.area === area.value);
    return (
      <div key={area.value} className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-bold text-gray-900">{area.label}</h3>
        <p className="text-xs text-gray-500 mb-3">{ACCESS_AREA_HINT[area.value]}</p>
        {grants.length === 0 ? (
          <p className="text-sm text-gray-400 mb-3">Only HR (and the Finance role) can see this.</p>
        ) : (
          <div className="space-y-2 mb-3">
            {grants.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{g.name}</p>
                  <p className="text-xs text-gray-500 truncate">{g.email}</p>
                </div>
                <button onClick={() => remove(g)} disabled={busy} className="text-red-600 text-sm font-semibold hover:underline shrink-0">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <select
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={adding[area.value] ?? ''}
            onChange={(e) => setAdding((a) => ({ ...a, [area.value]: e.target.value }))}
          >
            <option value="">Add a person&hellip;</option>
            {employees
              .filter((emp) => !grants.some((g) => g.employeeId === emp.id))
              .map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeCode})</option>
              ))}
          </select>
          <button
            onClick={() => add(area.value)}
            disabled={busy || !adding[area.value]}
            className="px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50"
          >
            Give access
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Give named people access to one area of every new hire&apos;s data, on top of HR. They see it (read-only) under
        <strong> Onboarding tasks</strong> in their menu; showing full numbers is audited.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* HR / Finance areas */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">HR &amp; Finance</h2>
        <div className="space-y-4">{hrAreas.map(areaCard)}</div>
      </div>

      {/* IT areas with bulk grant */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">IT Provisioning</h2>
          <div className="flex items-center gap-2">
            <select
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              value={bulkITEmployee}
              onChange={(e) => { setBulkITEmployee(e.target.value); setBulkMsg(null); }}
            >
              <option value="">Grant all IT access to&hellip;</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeCode})</option>
              ))}
            </select>
            <button
              onClick={grantBulkIT}
              disabled={busy || !bulkITEmployee}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              Grant all IT access
            </button>
          </div>
        </div>
        {bulkMsg && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-3">{bulkMsg}</p>}
        <div className="space-y-4">{itAreas.map(areaCard)}</div>
      </div>
    </div>
  );
}

function OfferLetterTemplatesTab() {
  const [templates, setTemplates] = useState<OfferLetterTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<OfferLetterTemplate | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      setTemplates(await onboardingApi.getOfferLetterTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load offer letter templates');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: number) => {
    if (!confirm('Remove this template?')) return;
    try {
      await onboardingApi.deactivateOfferLetterTemplate(id);
      load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to remove template');
    }
  };

  const makeDefault = async (id: number) => {
    try {
      await onboardingApi.updateOfferLetterTemplate(id, { isDefault: true });
      load();
    } catch (e) {
      alert(e instanceof OnboardingApiError ? e.message : 'Failed to set default');
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-4">
        <p className="text-sm text-gray-500 max-w-xl">
          These are the offer letters HR sends new hires. Pick one per hire in the &quot;Add New Employee&quot; form —
          e.g. a different template for interns vs. full-time roles.
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold text-sm hover:bg-purple-700 transition-colors shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
          Add Template
        </button>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading templates...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!isLoading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-bold text-gray-900">{t.name}</h3>
                  <p className="text-xs text-gray-500">{t.heading}</p>
                </div>
                {t.isDefault && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 shrink-0">
                    Default
                  </span>
                )}
              </div>
              {t.sourceDocxName ? (
                <div className="flex items-center gap-2 text-sm">
                  <FileTextIcon className="w-4 h-4 text-purple-600 shrink-0" />
                  {t.sourceDocxUrl ? (
                    <a href={t.sourceDocxUrl} target="_blank" rel="noreferrer" className="text-purple-600 hover:underline truncate">
                      {t.sourceDocxName}
                    </a>
                  ) : (
                    <span className="text-gray-600 truncate">{t.sourceDocxName}</span>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">{t.body}</p>
              )}
              <div className="flex gap-3 mt-4 pt-3 border-t border-gray-100">
                <button onClick={() => setEditing(t)} className="text-purple-600 text-sm font-semibold hover:underline">
                  Edit
                </button>
                {!t.isDefault && (
                  <button onClick={() => makeDefault(t.id)} className="text-gray-600 text-sm font-semibold hover:underline">
                    Make default
                  </button>
                )}
                <button onClick={() => remove(t.id)} className="text-red-600 text-sm font-semibold hover:underline ml-auto">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <OfferLetterTemplateModal
          template={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function OfferLetterTemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: OfferLetterTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<OfferLetterTemplateInput>(
    template
      ? { name: template.name, heading: template.heading, body: template.body, isDefault: template.isDefault }
      : { name: '', heading: 'Offer of Employment', body: '', isDefault: false },
  );
  const [file, setFile] = useState<File | null>(null);
  const [removeExistingFile, setRemoveExistingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasExistingFile = !!template?.sourceDocxName && !removeExistingFile;
  const usingWordFile = hasExistingFile || !!file;

  const placeholders = template?.placeholders ?? [
    'first_name', 'last_name', 'full_name', 'designation', 'department', 'employee_code',
    'joining_date', 'package', 'monthly_package', 'employment_type', 'probation_period_months',
    'notice_period_days', 'today', 'reporting_manager',
  ];

  const insertPlaceholder = (name: string) => {
    setForm((f) => ({ ...f, body: `${f.body ?? ''}{{${name}}}` }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Template name is required.');
      return;
    }
    if (!usingWordFile && !file && !form.body?.trim()) {
      setError('Upload a Word (.docx) template or type a letter body.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (template) {
        await onboardingApi.updateOfferLetterTemplate(
          template.id,
          { ...form, removeSourceDocx: removeExistingFile && !file },
          file,
        );
      } else {
        await onboardingApi.createOfferLetterTemplate(form, file);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Failed to save template');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">{template ? 'Edit offer letter template' : 'Add offer letter template'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Template name *">
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Contractor Offer" />
            </Field>
            <Field label="Letter heading">
              <input className="input" value={form.heading} onChange={(e) => setForm((f) => ({ ...f, heading: e.target.value }))} />
            </Field>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <span className="block text-xs font-semibold text-gray-600 mb-2">Upload a Word (.docx) template</span>
            {hasExistingFile ? (
              <div className="flex items-center gap-2 text-sm">
                <FileTextIcon className="w-4 h-4 text-purple-600 shrink-0" />
                <span className="text-gray-700 truncate flex-1">{template!.sourceDocxName}</span>
                <button
                  type="button"
                  onClick={() => setRemoveExistingFile(true)}
                  className="text-red-600 text-xs font-semibold hover:underline shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <input
                  type="file"
                  accept=".docx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm w-full"
                />
                <p className="text-xs text-gray-400 mt-1.5">
                  Type placeholders like <code className="font-mono">{'{{first_name}}'}</code> directly into your Word document —
                  they get filled in and the letter is sent as a PDF, with your formatting, logo and letterhead intact.
                </p>
              </>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="block text-xs font-semibold text-gray-600">
                Letter body {usingWordFile ? '(not used — a Word file is attached above)' : '*'}
              </span>
              <span className="text-xs text-gray-400">Blank line = new paragraph &middot; **bold** &middot; click a placeholder to insert</span>
            </div>
            <textarea
              className={`input font-mono text-xs ${usingWordFile ? 'opacity-50' : ''}`}
              rows={usingWordFile ? 4 : 14}
              value={form.body ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder={'Dear {{first_name}} {{last_name}},\n\nWe are pleased to offer you...'}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {placeholders.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => insertPlaceholder(p)}
                  className="px-2 py-1 rounded-md bg-gray-100 text-gray-700 text-xs font-mono hover:bg-purple-100 hover:text-purple-700"
                >
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isDefault ?? false}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
            />
            Use as the default template for new hires
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50">
              {submitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
