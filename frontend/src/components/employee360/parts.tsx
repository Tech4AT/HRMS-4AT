'use client';

import type { InputHTMLAttributes, ReactNode } from 'react';

/** A profile card: title, optional icon, and a slot for an action such as Edit. */
export function SectionCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
        <h3 className="min-w-0 truncate text-base font-bold text-slate-900 flex items-center gap-2">
          {icon ? <span className="text-slate-500 shrink-0">{icon}</span> : null}
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-xs font-semibold text-blue-600 hover:text-blue-700 shrink-0"
    >
      Edit
    </button>
  );
}

const LABEL_CLS = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide';

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={`${LABEL_CLS} mb-1.5`}>{label}</div>
      <div className="text-sm font-semibold text-slate-900 break-words">{value || '—'}</div>
    </div>
  );
}

const INPUT_CLS =
  'w-full px-3 py-2 text-sm font-medium text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-500 transition-all';

export function TextField({
  label,
  error,
  ...props
}: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block min-w-0">
      <span className={`${LABEL_CLS} block mb-1.5`}>{label}</span>
      <input {...props} aria-invalid={error ? true : undefined} className={INPUT_CLS} />
      {error ? <span className="block text-xs text-red-600 mt-1">{error}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className={`${LABEL_CLS} block mb-1.5`}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLS}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Save / Cancel row with the failure message, shared by every edit form. */
export function FormActions({
  saving,
  error,
  onCancel,
  saveLabel = 'Save',
}: {
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mt-5 pt-5 border-t border-slate-100">
      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm"
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors"
      >
        Cancel
      </button>
      {error ? (
        <span role="alert" className="text-sm font-medium text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

export const GENDER_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export function genderLabel(value: string): string {
  return GENDER_OPTIONS.find((g) => g.value === value)?.label ?? value;
}
