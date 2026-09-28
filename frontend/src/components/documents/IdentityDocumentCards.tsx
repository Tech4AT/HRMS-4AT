'use client';

import { useEffect, useState } from 'react';
import {
  onboardingApi,
  OnboardingApiError,
  IdentityDocument,
  IdentityDocumentType,
  IDENTITY_DOCUMENT_TYPE_LABEL,
  IDENTITY_NUMBER_FIELD_LABEL,
  VERIFICATION_STATUS_COLOR,
  formatDate,
} from '@/lib/api/onboarding';
import { documentsApi, DocumentsApiError, validateDocumentFile } from '@/lib/api/documents';
import {
  IDENTITY_TYPE_SPEC,
  IdentityField,
  formatIdentityNumber,
  normalizeIdentityNumber,
  validateIdentityNumber,
} from '@/lib/identityDocuments';
import { EyeIcon, EyeOffIcon, FileTextIcon, PlusIcon, CheckCircleIcon } from '@/components/icons';
import { ConfirmDialog } from '@/components/documents/ConfirmDialog';

const CARD_TYPES: IdentityDocumentType[] = ['aadhaar', 'pan', 'voter_id', 'passport', 'driving_license'];

const TYPE_ACCENT: Record<IdentityDocumentType, string> = {
  aadhaar: 'from-orange-500 to-amber-500',
  pan: 'from-sky-600 to-blue-600',
  voter_id: 'from-emerald-600 to-teal-600',
  passport: 'from-indigo-700 to-blue-800',
  driving_license: 'from-rose-500 to-pink-600',
  other: 'from-slate-500 to-slate-600',
};

const FIELD_LABEL: Record<IdentityField, string> = {
  fullName: 'Full name (as on document)',
  dateOfBirth: 'Date of birth',
  gender: 'Gender',
  parentOrGuardianName: 'Parent / guardian name',
  address: 'Address',
  expiryDate: 'Valid until',
};

function mask(type: IdentityDocumentType, value: string): string {
  const masked = value.length <= 4 ? value : '•'.repeat(value.length - 4) + value.slice(-4);
  return type === 'aadhaar' ? masked.replace(/(.{4})(?=.)/g, '$1 ') : masked;
}

function fieldValue(doc: IdentityDocument, field: IdentityField): string {
  if (field === 'dateOfBirth') return doc.dateOfBirth ? formatDate(doc.dateOfBirth) : '';
  if (field === 'expiryDate') return doc.expiryDate ? formatDate(doc.expiryDate) : '';
  return doc[field] || '';
}

export function IdentityDocumentCards({ employeeId, onChanged }: { employeeId: number; onChanged?: () => void }) {
  const [docs, setDocs] = useState<IdentityDocument[] | null>(null);
  const [editing, setEditing] = useState<{ type: IdentityDocumentType; doc: IdentityDocument | null } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<IdentityDocument | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState('');

  const load = async () => {
    try {
      setDocs(await onboardingApi.getMyIdentityDocuments());
    } catch {
      setDocs([]);
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
      await onboardingApi.removeMyIdentityDocument(removeTarget.id);
      setRemoveTarget(null);
      await changed();
    } catch (e) {
      setRemoveError(e instanceof OnboardingApiError ? e.message : 'Failed to remove document');
    } finally {
      setRemoveLoading(false);
    }
  };

  if (docs === null) return <p className="text-xs text-gray-400">Loading…</p>;

  const byType = (type: IdentityDocumentType) => docs.find((d) => d.documentType === type) ?? null;
  const others = docs.filter((d) => d.documentType === 'other');

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {CARD_TYPES.map((type) => (
          <IdentityCard
            key={type}
            type={type}
            doc={byType(type)}
            onAdd={() => setEditing({ type, doc: null })}
            onEdit={(doc) => setEditing({ type, doc })}
            onRemove={setRemoveTarget}
          />
        ))}
        {others.map((doc) => (
          <IdentityCard
            key={doc.id}
            type="other"
            doc={doc}
            onAdd={() => undefined}
            onEdit={(d) => setEditing({ type: 'other', doc: d })}
            onRemove={setRemoveTarget}
          />
        ))}
        <button
          onClick={() => setEditing({ type: 'other', doc: null })}
          className="rounded-2xl border-2 border-dashed border-gray-200 p-5 flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-purple-300 hover:text-purple-600 transition-colors min-h-[180px]"
        >
          <PlusIcon className="w-6 h-6" />
          <span className="text-sm font-semibold">Add another ID</span>
          <span className="text-xs text-gray-400">Any other government ID</span>
        </button>
      </div>

      {editing && (
        <IdentityDocumentDialog
          type={editing.type}
          doc={editing.doc}
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
          title={`Remove ${IDENTITY_DOCUMENT_TYPE_LABEL[removeTarget.documentType]}?`}
          description="This removes the details and any uploaded scan. You can add it again afterwards."
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

function IdentityCard({
  type,
  doc,
  onAdd,
  onEdit,
  onRemove,
}: {
  type: IdentityDocumentType;
  doc: IdentityDocument | null;
  onAdd: () => void;
  onEdit: (doc: IdentityDocument) => void;
  onRemove: (doc: IdentityDocument) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const spec = IDENTITY_TYPE_SPEC[type];

  if (!doc) {
    return (
      <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white">
        <div className={`bg-gradient-to-r ${TYPE_ACCENT[type]} px-4 py-3`}>
          <p className="text-white font-bold text-sm">{IDENTITY_DOCUMENT_TYPE_LABEL[type]}</p>
        </div>
        <div className="p-4 flex flex-col items-start gap-3">
          <p className="text-xs text-gray-500">Not added yet</p>
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-600 text-purple-600 text-xs font-semibold hover:bg-purple-50"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add {IDENTITY_DOCUMENT_TYPE_LABEL[type]}
          </button>
        </div>
      </div>
    );
  }

  const number = doc.documentNumber ?? '';
  const locked = doc.verificationStatus === 'verified';
  const title = type === 'other' ? doc.documentTypeDisplay : IDENTITY_DOCUMENT_TYPE_LABEL[type];
  const details = spec.fields
    .map((f) => ({ f, label: f === 'parentOrGuardianName' && spec.parentLabel ? spec.parentLabel : FIELD_LABEL[f], value: fieldValue(doc, f) }))
    .filter((d) => d.value);

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden bg-white flex flex-col">
      <div className={`bg-gradient-to-r ${TYPE_ACCENT[type]} px-4 py-3 flex items-center justify-between gap-2`}>
        <p className="text-white font-bold text-sm">{title}</p>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${VERIFICATION_STATUS_COLOR[doc.verificationStatus]}`}>
          {doc.verificationStatusDisplay}
        </span>
      </div>
      <div className="p-4 flex-1 flex flex-col gap-3">
        <div>
          <p className="text-[11px] text-gray-400">{IDENTITY_NUMBER_FIELD_LABEL[type]}</p>
          <div className="flex items-center gap-2">
            <p className="font-mono text-base font-semibold text-gray-900 tracking-wide">
              {number ? (revealed ? formatIdentityNumber(type, number) : mask(type, number)) : doc.documentNumberMasked}
            </p>
            {number && (
              <button
                onClick={() => setRevealed((r) => !r)}
                className="text-gray-400 hover:text-purple-600"
                title={revealed ? 'Hide number' : 'Show number'}
                aria-label={revealed ? 'Hide number' : 'Show number'}
              >
                {revealed ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {details.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            {details.map(({ f, label, value }) => (
              <div key={f} className={f === 'address' ? 'col-span-2' : ''}>
                <dt className="text-[11px] text-gray-400">{label}</dt>
                <dd className="text-xs text-gray-800 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {doc.verificationStatus === 'rejected' && doc.verificationNotes && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
            HR: {doc.verificationNotes} — please edit and resubmit.
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
          {doc.fileUrl ? (
            <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-purple-600 font-semibold hover:underline truncate">
              <FileTextIcon className="w-3.5 h-3.5 shrink-0" />
              View scan
            </a>
          ) : (
            <span className="text-xs text-gray-400">No scan uploaded</span>
          )}
          {locked ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold">
              <CheckCircleIcon className="w-3.5 h-3.5" />
              Verified — contact HR to change
            </span>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => onEdit(doc)} className="text-xs font-semibold text-purple-600 hover:underline">
                Edit
              </button>
              <button onClick={() => onRemove(doc)} className="text-xs font-semibold text-red-500 hover:underline">
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IdentityDocumentDialog({
  type,
  doc,
  employeeId,
  onClose,
  onSaved,
}: {
  type: IdentityDocumentType;
  doc: IdentityDocument | null;
  employeeId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const spec = IDENTITY_TYPE_SPEC[type];
  const [number, setNumber] = useState(doc?.documentNumber ? formatIdentityNumber(type, doc.documentNumber) : '');
  const [values, setValues] = useState<Record<IdentityField, string>>({
    fullName: doc?.fullName ?? '',
    dateOfBirth: doc?.dateOfBirth ?? '',
    gender: doc?.gender ?? '',
    parentOrGuardianName: doc?.parentOrGuardianName ?? '',
    address: doc?.address ?? '',
    expiryDate: doc?.expiryDate ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [numberTouched, setNumberTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numberError = validateIdentityNumber(type, number);

  const onNumberChange = (raw: string) => {
    let n = normalizeIdentityNumber(raw);
    n = spec.numeric ? n.replace(/\D/g, '') : n.replace(/[^A-Z0-9/]/g, '');
    n = n.slice(0, spec.maxLength);
    setNumber(formatIdentityNumber(type, n));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNumberTouched(true);
    setError(null);
    if (numberError) return;
    if (file) {
      const fileError = validateDocumentFile(file);
      if (fileError) {
        setError(fileError);
        return;
      }
    }
    const payload = {
      documentNumber: normalizeIdentityNumber(number),
      ...Object.fromEntries(spec.fields.map((f) => [f, (f === 'dateOfBirth' || f === 'expiryDate') ? values[f] || null : values[f]])),
    };
    setSubmitting(true);
    try {
      const saved = doc
        ? await onboardingApi.updateMyIdentityDocument(doc.id, payload)
        : await onboardingApi.addMyIdentityDocument({ documentType: type, ...payload });
      if (file) {
        const previous = doc ? await documentsApi.list('identity_document', doc.id) : [];
        await documentsApi.upload(file, 'identity_document', saved.id, employeeId);
        for (const old of previous) await documentsApi.remove(old.id);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof OnboardingApiError || err instanceof DocumentsApiError ? err.message : 'Failed to save document');
    } finally {
      setSubmitting(false);
    }
  };

  const label = type === 'other' && doc ? doc.documentTypeDisplay : IDENTITY_DOCUMENT_TYPE_LABEL[type];
  const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className={`bg-gradient-to-r ${TYPE_ACCENT[type]} px-6 py-4 rounded-t-2xl`}>
          <h2 className="text-lg font-bold text-white">{doc ? `Edit ${label}` : `Add ${label}`}</h2>
          {doc && <p className="text-white/80 text-xs mt-0.5">Saving changes sends it back to HR for verification.</p>}
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">{IDENTITY_NUMBER_FIELD_LABEL[type]} *</span>
            <input
              className={`${inputClass} font-mono tracking-wide ${numberTouched && numberError ? 'border-red-400' : ''}`}
              value={number}
              placeholder={spec.placeholder}
              inputMode={spec.numeric ? 'numeric' : 'text'}
              autoComplete="off"
              onChange={(e) => onNumberChange(e.target.value)}
              onBlur={() => setNumberTouched(true)}
            />
            <span className={`block text-[11px] mt-1 ${numberTouched && numberError ? 'text-red-600' : 'text-gray-400'}`}>
              {numberTouched && numberError ? numberError : spec.rule}
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            {spec.fields.map((f) => (
              <label key={f} className={`block ${f === 'address' || f === 'fullName' ? 'col-span-2' : ''}`}>
                <span className="block text-xs font-semibold text-gray-600 mb-1">
                  {f === 'parentOrGuardianName' && spec.parentLabel ? spec.parentLabel : FIELD_LABEL[f]}
                </span>
                {f === 'address' ? (
                  <textarea className={inputClass} rows={2} value={values[f]} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />
                ) : f === 'gender' ? (
                  <select className={inputClass} value={values[f]} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <input
                    type={f === 'dateOfBirth' || f === 'expiryDate' ? 'date' : 'text'}
                    className={inputClass}
                    value={values[f]}
                    onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                  />
                )}
              </label>
            ))}
          </div>

          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">
              {doc?.fileUrl ? 'Replace scan/photo (optional)' : 'Upload a scan/photo (optional)'}
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
              {submitting ? 'Saving…' : doc ? 'Save changes' : `Save ${label}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
