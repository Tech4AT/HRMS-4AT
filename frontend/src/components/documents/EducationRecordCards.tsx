'use client';

import { useEffect, useRef, useState } from 'react';
import {
  onboardingApi,
  OnboardingApiError,
  EducationRecord,
  VERIFICATION_STATUS_COLOR,
} from '@/lib/api/onboarding';
import { documentsApi, DocumentsApiError, validateDocumentFile } from '@/lib/api/documents';
import { GraduationCapIcon, FileTextIcon, PlusIcon, CheckCircleIcon } from '@/components/icons';
import { ConfirmDialog } from '@/components/documents/ConfirmDialog';

const DEGREE_SUGGESTIONS = [
  '10th / SSC', '12th / Intermediate', 'Diploma', 'B.Tech', 'B.E.', 'B.Sc', 'B.Com', 'BCA', 'BBA', 'B.A.',
  'M.Tech', 'M.E.', 'MBA', 'MCA', 'M.Sc', 'M.Com', 'M.A.', 'Ph.D',
];

const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: thisYear + 6 - 1970 + 1 }, (_, i) => thisYear + 6 - i);

function gradeLabel(grade: string): string {
  const n = parseFloat(grade);
  if (Number.isNaN(n)) return grade;
  return n <= 10 ? `${grade} CGPA` : `${grade}%`;
}

export function EducationRecordCards({ employeeId, onChanged }: { employeeId: number; onChanged?: () => void }) {
  const [records, setRecords] = useState<EducationRecord[] | null>(null);
  const [editing, setEditing] = useState<{ record: EducationRecord | null } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<EducationRecord | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const load = async () => {
    try {
      setRecords(await onboardingApi.getMyEducationRecords());
    } catch {
      setRecords([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const changed = async () => {
    await load();
    onChanged?.();
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoveLoading(true);
    setRemoveError('');
    try {
      await onboardingApi.removeMyEducationRecord(removeTarget.id);
      setRemoveTarget(null);
      await changed();
    } catch (e) {
      setRemoveError(e instanceof OnboardingApiError ? e.message : 'Failed to remove record');
    } finally {
      setRemoveLoading(false);
    }
  };

  if (records === null) return <p className="text-xs text-gray-400">Loading…</p>;

  const sorted = [...records].sort((a, b) => (b.yearOfCompletion ?? 0) - (a.yearOfCompletion ?? 0));

  return (
    <div className="space-y-4">
      {sorted.length === 0 && (
        <p className="text-sm text-gray-500">No qualifications added yet. Add each one — school, college, and any degrees — with its certificate.</p>
      )}
      {sorted.map((record) => (
        <EducationCard key={record.id} record={record} onEdit={() => setEditing({ record })} onRemove={() => setRemoveTarget(record)} />
      ))}
      <button
        onClick={() => setEditing({ record: null })}
        className="w-full rounded-2xl border-2 border-dashed border-gray-200 py-4 flex items-center justify-center gap-2 text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors text-sm font-semibold"
      >
        <PlusIcon className="w-4 h-4" />
        Add qualification
      </button>

      {editing && (
        <EducationDialog
          record={editing.record}
          employeeId={employeeId}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await changed();
          }}
        />
      )}
      {removeTarget ? (
        <ConfirmDialog
          title={`Remove ${removeTarget.degree}?`}
          description="This removes the details and the uploaded certificate. You can add it again afterwards."
          tone="danger"
          confirmLabel="Remove"
          loading={removeLoading}
          error={removeError}
          onCancel={() => {
            if (removeLoading) return;
            setRemoveTarget(null);
            setRemoveError('');
          }}
          onConfirm={confirmRemove}
        />
      ) : null}
    </div>
  );
}

function EducationCard({ record, onEdit, onRemove }: { record: EducationRecord; onEdit: () => void; onRemove: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const locked = record.verificationStatus === 'verified';

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const fields: { label: string; value: string }[] = [
    { label: 'Degree', value: record.degree },
    { label: 'Branch / Specialization', value: record.branch },
    { label: 'Year of joining', value: record.yearOfJoining ? String(record.yearOfJoining) : '' },
    { label: 'Year of completion', value: record.yearOfCompletion ? String(record.yearOfCompletion) : '' },
    { label: 'CGPA / Percentage', value: record.grade ? gradeLabel(record.grade) : '' },
    { label: 'University / College', value: record.university },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <GraduationCapIcon className="w-4 h-4" />
          </div>
          <p className="font-bold text-gray-900 truncate">{record.degree}</p>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${VERIFICATION_STATUS_COLOR[record.verificationStatus]}`}>
            {record.verificationStatusDisplay}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {record.fileUrl ? (
            <a
              href={record.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50"
            >
              <FileTextIcon className="w-4 h-4" />
              View file
            </a>
          ) : (
            <span className="text-xs text-amber-600 font-semibold">Certificate not uploaded</span>
          )}
          {locked ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold" title="Verified — contact HR to change">
              <CheckCircleIcon className="w-4 h-4" />
            </span>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 flex items-center justify-center text-lg leading-none"
                aria-label="More actions"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-9 z-10 w-36 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                  <button onClick={() => { setMenuOpen(false); onEdit(); }} className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    Edit
                  </button>
                  <button onClick={() => { setMenuOpen(false); onRemove(); }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-gray-50">
                    Remove
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4 px-5 py-4">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{f.label}</dt>
            <dd className="text-sm text-gray-900 uppercase break-words mt-0.5">{f.value || '—'}</dd>
          </div>
        ))}
      </dl>
      {record.verificationStatus === 'rejected' && record.verificationNotes && (
        <p className="mx-5 mb-4 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
          HR: {record.verificationNotes} — please edit and resubmit.
        </p>
      )}
    </div>
  );
}

function EducationDialog({
  record,
  employeeId,
  onClose,
  onSaved,
}: {
  record: EducationRecord | null;
  employeeId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    degree: record?.degree ?? '',
    branch: record?.branch ?? '',
    university: record?.university ?? '',
    yearOfJoining: record?.yearOfJoining ? String(record.yearOfJoining) : '',
    yearOfCompletion: record?.yearOfCompletion ? String(record.yearOfCompletion) : '',
    grade: record?.grade ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = (): string | null => {
    if (!form.degree.trim()) return 'Degree is required.';
    if (!form.university.trim()) return 'University / college is required.';
    if (!form.yearOfCompletion) return 'Year of completion is required.';
    if (form.yearOfJoining && Number(form.yearOfCompletion) < Number(form.yearOfJoining)) {
      return 'Year of completion cannot be before the year of joining.';
    }
    const g = parseFloat(form.grade.replace('%', ''));
    if (!form.grade.trim() || Number.isNaN(g) || g <= 0 || g > 100) return 'Enter your CGPA (e.g. 8.5) or percentage (e.g. 73).';
    if (!record && !file) return 'Please upload the certificate.';
    if (file) return validateDocumentFile(file);
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    const payload = {
      degree: form.degree.trim(),
      branch: form.branch.trim(),
      university: form.university.trim(),
      yearOfJoining: form.yearOfJoining ? Number(form.yearOfJoining) : null,
      yearOfCompletion: Number(form.yearOfCompletion),
      grade: form.grade.trim(),
    };
    setSubmitting(true);
    try {
      const saved = record
        ? await onboardingApi.updateMyEducationRecord(record.id, payload)
        : await onboardingApi.addMyEducationRecord(payload);
      if (file) {
        const previous = record ? await documentsApi.list('education_record', record.id) : [];
        await documentsApi.upload(file, 'education_record', saved.id, employeeId);
        for (const old of previous) await documentsApi.remove(old.id);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof OnboardingApiError || err instanceof DocumentsApiError ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 rounded-t-2xl">
          <h2 className="text-lg font-bold text-white">{record ? 'Edit qualification' : 'Add qualification'}</h2>
          <p className="text-white/80 text-xs mt-0.5">
            {record ? 'Saving changes sends it back to HR for verification.' : 'Degrees & Certificates — one entry per qualification.'}
          </p>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Degree *</span>
              <input className={inputClass} list="degree-suggestions" value={form.degree} onChange={set('degree')} placeholder="e.g. B.Tech" />
              <datalist id="degree-suggestions">
                {DEGREE_SUGGESTIONS.map((d) => <option key={d} value={d} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Branch / Specialization</span>
              <input className={inputClass} value={form.branch} onChange={set('branch')} placeholder="e.g. Computer Science" />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">University / College *</span>
            <input className={inputClass} value={form.university} onChange={set('university')} placeholder="e.g. Vignana Bharathi Institute of Technology" />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Year of joining</span>
              <select className={inputClass} value={form.yearOfJoining} onChange={set('yearOfJoining')}>
                <option value="">—</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Year of completion *</span>
              <select className={inputClass} value={form.yearOfCompletion} onChange={set('yearOfCompletion')}>
                <option value="">—</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">CGPA / % *</span>
              <input className={inputClass} inputMode="decimal" value={form.grade} onChange={set('grade')} placeholder="8.5 or 73" />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">
              {record?.fileUrl ? 'Replace certificate (optional)' : 'Certificate *'}
            </span>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className="block text-[11px] text-gray-400 mt-1">PDF, JPG or PNG, up to 10 MB.</span>
          </label>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold text-sm hover:bg-purple-700 disabled:opacity-50">
              {submitting ? 'Saving…' : record ? 'Save changes' : 'Save qualification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
