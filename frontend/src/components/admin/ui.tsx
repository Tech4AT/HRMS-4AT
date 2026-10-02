'use client';

import { useEffect, type ReactNode, type ButtonHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { ApiError } from '@/lib/admin/api';

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const details = Object.entries(e.fields)
      .map(([k, v]) => `${k === 'nonFieldErrors' ? '' : `${k}: `}${(Array.isArray(v) ? v : [v]).join(' ')}`)
      .join(' ');
    return details && details !== e.message ? `${e.message} ${details}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-purple-600 text-white hover:bg-purple-700 disabled:bg-purple-300',
  secondary: 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 disabled:text-gray-400',
  danger: 'bg-white text-red-600 border border-red-300 hover:bg-red-50 disabled:text-red-300',
  ghost: 'text-purple-700 hover:bg-purple-50 disabled:text-gray-400',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  );
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'green' | 'red' | 'purple' | 'amber'; children: ReactNode }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
    amber: 'bg-amber-100 text-amber-800',
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-100 ${className}`}
    />
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const tones = {
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-green-50 border-green-200 text-green-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`border rounded-lg px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
}

export function Drawer({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-white w-full sm:w-[30rem] lg:w-[36rem] h-full overflow-y-auto shadow-xl"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 text-lg truncate">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-900 text-2xl leading-none px-2">
            ×
          </button>
        </div>
        <div className="p-5 space-y-6">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-bold text-slate-900 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A yes/no question. `busy` disables the buttons while the action runs; `error` shows why it failed. */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm text-gray-700 space-y-3">{body}</div>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="text-xs text-gray-500 mt-3">{total} in total</p>;
  return (
    <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
      <span>
        Page {page} of {pages} · {total} in total
      </span>
      <div className="flex gap-2">
        <Button onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <Button onClick={() => onPage(page + 1)} disabled={page >= pages}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-base font-bold text-slate-900">{children}</h3>
      {hint && <p className="text-sm text-gray-500">{hint}</p>}
    </div>
  );
}
