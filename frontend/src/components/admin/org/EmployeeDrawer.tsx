'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { ApiError, adminApi, formatWhen, humanizeAction, type AuditEntry } from '@/lib/admin/api';
import {
  EMPLOYMENT_TYPES,
  GENDERS,
  STATUS_LABELS,
  WORK_MODES,
  fmtDate,
  fullName,
  orgApi,
  type EmployeeInput,
  type EmployeeRow,
  type EmploymentType,
  type PersonalDetails,
  type WorkMode,
} from '@/lib/admin/orgApi';
import { Badge, Button, ConfirmModal, Drawer, Modal, Notice, SectionTitle, Select, errorText } from '../ui';
import type { Lookups, Named } from './useOrgData';

interface Form {
  first_name: string;
  last_name: string;
  work_email: string;
  employee_code: string;
  designation_id: string;
  department_id: string;
  location_id: string;
  legal_entity_id: string;
  business_unit_id: string;
  cost_center_id: string;
  manager_id: string;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  date_of_joining: string;
}

const EMPTY: Form = {
  first_name: '',
  last_name: '',
  work_email: '',
  employee_code: '',
  designation_id: '',
  department_id: '',
  location_id: '',
  legal_entity_id: '',
  business_unit_id: '',
  cost_center_id: '',
  manager_id: '',
  employment_type: 'full_time',
  work_mode: 'office',
  date_of_joining: '',
};

const REFERENCE_FIELDS = ['designation_id', 'department_id', 'location_id', 'legal_entity_id', 'business_unit_id', 'cost_center_id', 'manager_id'] as const;

function toForm(e: EmployeeRow | null): Form {
  if (!e) return EMPTY;
  return {
    first_name: e.first_name,
    last_name: e.last_name,
    work_email: e.work_email ?? '',
    employee_code: e.employee_code,
    designation_id: e.designation_id ?? '',
    department_id: e.department_id ?? '',
    location_id: e.location_id ?? '',
    legal_entity_id: e.legal_entity_id ?? '',
    business_unit_id: e.business_unit_id ?? '',
    cost_center_id: e.cost_center_id ?? '',
    manager_id: e.manager_id ?? '',
    employment_type: e.employment_type,
    work_mode: e.work_mode ?? 'office',
    date_of_joining: e.date_of_joining ?? '',
  };
}

function fieldError(err: unknown, name: string): string | null {
  if (err instanceof ApiError && err.fields[name]) {
    const v = err.fields[name];
    return Array.isArray(v) ? v.join(' ') : String(v);
  }
  return null;
}

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100';

/** A pick-list that keeps showing the current value even if it has since been deactivated. */
function UnitSelect({ value, items, onChange, disabled, label, blank }: { value: string; items: Named[]; onChange: (v: string) => void; disabled: boolean; label: string; blank: string }) {
  const known = items.some((i) => i.id === value);
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{blank}</option>
      {value && !known && <option value={value}>(no longer active)</option>}
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </Select>
  );
}

function ManagerPicker({ value, employees, excludeId, onChange, disabled, error }: { value: string; employees: EmployeeRow[]; excludeId: string | null; onChange: (v: string) => void; disabled: boolean; error?: string | null }) {
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    const matches = employees.filter((e) => e.id !== excludeId && e.status !== 'exited' && (!term || fullName(e).toLowerCase().includes(term) || e.employee_code.toLowerCase().includes(term)));
    const selected = employees.find((e) => e.id === value);
    const list = matches.slice(0, 40);
    if (selected && !list.some((e) => e.id === selected.id)) list.unshift(selected);
    return list;
  }, [employees, q, value, excludeId]);

  return (
    <Field label="Reports to" error={error}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search for a manager…"
        aria-label="Search for a manager"
        disabled={disabled}
        className={`${inputClass} mb-2`}
      />
      <Select aria-label="Reports to" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">No manager</option>
        {options.map((e) => (
          <option key={e.id} value={e.id}>
            {fullName(e)} ({e.employee_code})
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function EmployeeDrawer({
  employee,
  employees,
  lookups,
  canWrite,
  canEditReportingLine = false,
  onClose,
  onSaved,
}: {
  employee: EmployeeRow | null; // null = adding a new person
  employees: EmployeeRow[];
  lookups: Lookups;
  /** May edit every field (employees.write). */
  canWrite: boolean;
  /** May change who this person reports to and nothing else
   *  (employees.reporting_line.write: a Manager, for their own team). Only
   *  matters when `canWrite` is false. */
  canEditReportingLine?: boolean;
  onClose: () => void;
  onSaved: (saved: EmployeeRow, message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const isNew = employee === null;
  const [form, setForm] = useState<Form>(() => toForm(employee));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusDialog, setStatusDialog] = useState<null | 'leave' | 'exit' | 'return' | 'active'>(null);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [exitDate, setExitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exitReason, setExitReason] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);

  // Reset the form when a different person is opened, or when the record is refreshed.
  useEffect(() => {
    setForm(toForm(employee));
  }, [employee]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const original = useMemo(() => toForm(employee), [employee]);
  const changedKeys = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== original[k]);
  const readOnly = !canWrite;
  // A Manager may reassign reporting lines in their team but edit nothing else, so
  // for them only the manager picker is live and only `manager_id` is sent.
  const reportingLineOnly = !canWrite && canEditReportingLine && !isNew;

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {};
      const keys = isNew
        ? (Object.keys(form) as (keyof Form)[])
        : reportingLineOnly
          ? changedKeys.filter((k) => k === 'manager_id')
          : changedKeys;
      for (const k of keys) {
        const v = form[k];
        const nullable = (REFERENCE_FIELDS as readonly string[]).includes(k) || k === 'date_of_joining';
        if (v === '' && nullable) {
          if (!isNew) body[k] = null;
        } else if (v !== '' || isNew) {
          body[k] = v;
        }
      }
      const saved = isNew ? await orgApi.createEmployee(body as EmployeeInput) : await orgApi.updateEmployee(employee.id, body as EmployeeInput);
      onSaved(saved, isNew ? `${fullName(saved)} was added. They cannot sign in until an administrator sets a password (Access control, People).` : 'Saved.');
      if (isNew) onClose();
      else setMessage('Saved.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (input: EmployeeInput, done: string) => {
    if (!employee) return;
    setBusy(true);
    setStatusError(null);
    try {
      const saved = await orgApi.updateEmployee(employee.id, input);
      onSaved(saved, done);
      setMessage(done);
      setStatusDialog(null);
    } catch (e) {
      setStatusError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const name = employee ? fullName(employee) || employee.work_email : 'New employee';

  return (
    <Drawer title={name} subtitle={employee ? employee.employee_code : 'Add someone to the directory'} onClose={onClose}>
      {readOnly && (
        <Notice tone="info">
          {reportingLineOnly
            ? 'You can change who this person reports to. Everything else on this record is view-only.'
            : 'You can view this record but not change it.'}
        </Notice>
      )}
      {!!error && !(error instanceof ApiError && Object.keys(error.fields).length > 0 && error.status === 400) && <Notice tone="error">{errorText(error)}</Notice>}

      <section className="space-y-3">
        <SectionTitle>Identity</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={fieldError(error, 'first_name')}>
            <input className={inputClass} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Last name" error={fieldError(error, 'last_name')}>
            <input className={inputClass} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} disabled={readOnly} />
          </Field>
        </div>
        <Field label="Work email" error={fieldError(error, 'work_email')}>
          <input className={inputClass} type="email" value={form.work_email} onChange={(e) => set('work_email', e.target.value)} disabled={readOnly} />
        </Field>
        <Field label="Employee code" error={fieldError(error, 'employee_code')}>
          <input className={inputClass} value={form.employee_code} onChange={(e) => set('employee_code', e.target.value)} disabled={readOnly} />
        </Field>
      </section>

      <section className="space-y-3">
        <SectionTitle>Job</SectionTitle>
        <Field label="Job title" error={fieldError(error, 'designation_id')}>
          <UnitSelect label="Job title" blank="Not set" value={form.designation_id} items={lookups.designations} onChange={(v) => set('designation_id', v)} disabled={readOnly} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department" error={fieldError(error, 'department_id')}>
            <UnitSelect label="Department" blank="Not set" value={form.department_id} items={lookups.departments} onChange={(v) => set('department_id', v)} disabled={readOnly} />
          </Field>
          <Field label="Location" error={fieldError(error, 'location_id')}>
            <UnitSelect label="Location" blank="Not set" value={form.location_id} items={lookups.locations} onChange={(v) => set('location_id', v)} disabled={readOnly} />
          </Field>
        </div>
        <ManagerPicker value={form.manager_id} employees={employees} excludeId={employee?.id ?? null} onChange={(v) => set('manager_id', v)} disabled={readOnly && !reportingLineOnly} error={fieldError(error, 'manager_id')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Employment type" error={fieldError(error, 'employment_type')}>
            <Select aria-label="Employment type" value={form.employment_type} onChange={(e) => set('employment_type', e.target.value as EmploymentType)} disabled={readOnly}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date of joining" error={fieldError(error, 'date_of_joining')}>
            <input className={inputClass} type="date" value={form.date_of_joining} onChange={(e) => set('date_of_joining', e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Work mode" error={fieldError(error, 'work_mode')}>
            <Select aria-label="Work mode" value={form.work_mode} onChange={(e) => set('work_mode', e.target.value as WorkMode)} disabled={readOnly}>
              {WORK_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Organisation</SectionTitle>
        <Field label="Legal entity" error={fieldError(error, 'legal_entity_id')}>
          <UnitSelect label="Legal entity" blank="Not set" value={form.legal_entity_id} items={lookups.legalEntities} onChange={(v) => set('legal_entity_id', v)} disabled={readOnly} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Business unit" error={fieldError(error, 'business_unit_id')}>
            <UnitSelect label="Business unit" blank="Not set" value={form.business_unit_id} items={lookups.businessUnits} onChange={(v) => set('business_unit_id', v)} disabled={readOnly} />
          </Field>
          <Field label="Cost centre" error={fieldError(error, 'cost_center_id')}>
            <UnitSelect label="Cost centre" blank="Not set" value={form.cost_center_id} items={lookups.costCenters} onChange={(v) => set('cost_center_id', v)} disabled={readOnly} />
          </Field>
        </div>
      </section>

      {(!readOnly || reportingLineOnly) && (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={saving || (!isNew && (reportingLineOnly ? !changedKeys.includes('manager_id') : changedKeys.length === 0)) || (isNew && (!form.first_name.trim() || !form.work_email.trim() || !form.employee_code.trim()))}>
            {saving ? 'Saving…' : isNew ? 'Add employee' : 'Save changes'}
          </Button>
          {message && <Notice tone="success">{message}</Notice>}
        </div>
      )}

      {employee && (
        <>
          <StatusSection employee={employee} canWrite={canWrite} onAction={setStatusDialog} />
          <PersonalSection
            employee={employee}
            canRead={hasPermission('employees.personal.read')}
            canWrite={hasPermission('employees.personal.write')}
            onSaved={() => setHistoryVersion((v) => v + 1)}
          />
          {hasPermission('audit.read') && <HistorySection employee={employee} refreshKey={`${historyVersion}:${employee.status}:${employee.manager_id ?? ''}:${employee.department_id ?? ''}`} />}
          <p className="text-xs text-gray-500">
            Their role and sign-in are managed under{' '}
            <Link href="/admin?tab=people" className="text-purple-700 font-semibold hover:underline">
              Access control
            </Link>
            .
          </p>
        </>
      )}

      {statusDialog === 'leave' && (
        <ConfirmModal
          title={`Mark ${name} as on leave?`}
          body={<p>They stay signed in and keep their access. Only their status changes.</p>}
          confirmLabel="Mark as on leave"
          busy={busy}
          error={statusError}
          onCancel={() => setStatusDialog(null)}
          onConfirm={() => changeStatus({ status: 'on_leave' }, 'Marked as on leave.')}
        />
      )}
      {statusDialog === 'active' && (
        <ConfirmModal
          title={`Mark ${name} as active?`}
          body={<p>They are back at work.</p>}
          confirmLabel="Mark as active"
          busy={busy}
          error={statusError}
          onCancel={() => setStatusDialog(null)}
          onConfirm={() => changeStatus({ status: 'active' }, 'Marked as active.')}
        />
      )}
      {statusDialog === 'return' && (
        <ConfirmModal
          title={`Bring ${name} back?`}
          body={<p>Their sign-in is restored, and the exit date and reason are cleared. Their role stays as it was.</p>}
          confirmLabel="Bring back"
          busy={busy}
          error={statusError}
          onCancel={() => setStatusDialog(null)}
          onConfirm={() => changeStatus({ status: 'active' }, 'Brought back. Their sign-in is restored.')}
        />
      )}
      {statusDialog === 'exit' && (
        <Modal title={`Record that ${name} has left`} onClose={() => setStatusDialog(null)}>
          <div className="space-y-4 text-sm">
            <p className="text-gray-700">Their sign-in ends immediately and every session they have open is closed. Their records are kept.</p>
            <Field label="Last working day">
              <input className={inputClass} type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            </Field>
            <Field label="Reason (optional)">
              <input className={inputClass} value={exitReason} onChange={(e) => setExitReason(e.target.value)} placeholder="e.g. Resigned, contract ended" />
            </Field>
            {statusError && <Notice tone="error">{statusError}</Notice>}
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setStatusDialog(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={busy || !exitDate}
                onClick={() => changeStatus({ status: 'exited', date_of_exit: exitDate, exit_reason: exitReason }, 'Recorded as having left. Their sign-in has ended.')}
              >
                {busy ? 'Working…' : 'Record departure'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Drawer>
  );
}

function StatusSection({ employee, canWrite, onAction }: { employee: EmployeeRow; canWrite: boolean; onAction: (a: 'leave' | 'exit' | 'return' | 'active') => void }) {
  return (
    <section className="space-y-3">
      <SectionTitle>Employment status</SectionTitle>
      <div className="flex items-center gap-2">
        {employee.status === 'active' && <Badge tone="green">{STATUS_LABELS.active}</Badge>}
        {employee.status === 'on_leave' && <Badge tone="amber">{STATUS_LABELS.on_leave}</Badge>}
        {employee.status === 'exited' && <Badge tone="red">{STATUS_LABELS.exited}</Badge>}
        {employee.status === 'exited' && <span className="text-sm text-gray-600">Left on {fmtDate(employee.date_of_exit)}</span>}
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {employee.status === 'active' && <Button onClick={() => onAction('leave')}>Mark as on leave</Button>}
          {employee.status === 'on_leave' && <Button onClick={() => onAction('active')}>Mark as active</Button>}
          {employee.status !== 'exited' && (
            <Button variant="danger" onClick={() => onAction('exit')}>
              Record departure
            </Button>
          )}
          {employee.status === 'exited' && <Button onClick={() => onAction('return')}>Bring back</Button>}
        </div>
      )}
    </section>
  );
}

function PersonalSection({ employee, canRead, canWrite, onSaved }: { employee: EmployeeRow; canRead: boolean; canWrite: boolean; onSaved: () => void }) {
  const [details, setDetails] = useState<PersonalDetails | null>(null);
  const [draft, setDraft] = useState<PersonalDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(!canRead);

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    orgApi
      .getPersonal(employee.id)
      .then((d) => {
        if (!cancelled) {
          setDetails(d);
          setDraft(d);
          setDenied(false);
        }
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 403) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [employee.id, canRead]);

  if (denied || !details || !draft) return null;

  const dirty = (['personal_email', 'phone', 'dob', 'gender'] as const).some((k) => (draft[k] ?? '') !== (details[k] ?? ''));

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body: Partial<PersonalDetails> = {
        personal_email: draft.personal_email,
        phone: draft.phone,
        dob: draft.dob || null,
        gender: draft.gender,
      };
      const saved = await orgApi.updatePersonal(employee.id, body);
      setDetails(saved);
      setDraft(saved);
      setMessage('Saved.');
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const edit = <K extends keyof PersonalDetails>(k: K, v: PersonalDetails[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <section className="space-y-3">
      <SectionTitle hint="Held back from the ordinary directory. Only people with permission see this, and changes are recorded without the values.">Personal details</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Personal email" error={fieldError(error, 'personal_email')}>
          <input className={inputClass} type="email" value={draft.personal_email} onChange={(e) => edit('personal_email', e.target.value)} disabled={!canWrite} />
        </Field>
        <Field label="Phone" error={fieldError(error, 'phone')}>
          <input className={inputClass} value={draft.phone} onChange={(e) => edit('phone', e.target.value)} disabled={!canWrite} />
        </Field>
        <Field label="Date of birth" error={fieldError(error, 'dob')}>
          <input className={inputClass} type="date" value={draft.dob ?? ''} onChange={(e) => edit('dob', e.target.value || null)} disabled={!canWrite} />
        </Field>
        <Field label="Gender" error={fieldError(error, 'gender')}>
          <Select aria-label="Gender" value={draft.gender} onChange={(e) => edit('gender', e.target.value)} disabled={!canWrite}>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {details.exit_reason && <p className="text-sm text-gray-600">Reason for leaving: {details.exit_reason}</p>}
      {!!error && !fieldError(error, 'personal_email') && !fieldError(error, 'dob') && !fieldError(error, 'gender') && !fieldError(error, 'phone') && <Notice tone="error">{errorText(error)}</Notice>}
      {canWrite && (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save personal details'}
          </Button>
          {message && <Notice tone="success">{message}</Notice>}
        </div>
      )}
    </section>
  );
}

function HistorySection({ employee, refreshKey }: { employee: EmployeeRow; refreshKey: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listAudit({ entity_type: 'Employee', entity_id: employee.id, pageSize: 15 })
      .then((p) => !cancelled && setEntries(p.results))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [employee.id, refreshKey]);

  if (failed) return null;
  return (
    <section className="space-y-3">
      <SectionTitle hint="Every change to this record, newest first.">History</SectionTitle>
      {!entries && <p className="text-sm text-gray-500">Loading…</p>}
      {entries && entries.length === 0 && <p className="text-sm text-gray-500">No recorded changes yet.</p>}
      {entries && entries.length > 0 && (
        <ul className="border border-gray-200 rounded-xl divide-y divide-gray-100 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="px-3 py-2 flex justify-between gap-3">
              <span className="text-gray-900">
                {humanizeAction(e.action)} <span className="text-gray-400">by {e.actorName ?? 'the system'}</span>
              </span>
              <span className="text-xs text-gray-500 whitespace-nowrap">{formatWhen(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
