'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangleIcon, XIcon } from '@/components/icons';

export interface ConfirmDialogReasonConfig {
  label: string;
  placeholder?: string;
  /** Defaults to true — the one existing use (rejecting a document) always
   * requires a reason; a future non-required use can opt out explicitly. */
  required?: boolean;
}

export interface ConfirmDialogProps {
  title: string;
  description: string;
  /** 'danger' tints the confirm button red and the icon red — for anything
   * destructive or a rejection. 'default' keeps the HRMS purple. */
  tone?: 'default' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  /** Set by the caller when the last confirm attempt failed server-side
   * (e.g. a 409 conflict) — shown above the actions, dialog stays open. */
  error?: string;
  /** When set, renders a textarea and passes its value to `onConfirm` —
   * the one reusable dialog covers both "Delete document?" (no reason) and
   * "Reject document" (reason required), per the module's own rule against
   * a second confirmation-dialog implementation. */
  reason?: ConfirmDialogReasonConfig;
  onCancel: () => void;
  onConfirm: (reason?: string) => void;
}

/** The one confirmation dialog for the whole Documents module — replaces
 * every native confirm()/alert() call site. Danger-tone confirmations
 * (delete) and reason-required confirmations (reject) are both this same
 * component, never a bespoke one-off. */
export function ConfirmDialog({
  title,
  description,
  tone = 'default',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  error,
  reason,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [reasonValue, setReasonValue] = useState('');
  const [reasonError, setReasonError] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const reasonRequired = reason?.required !== false;

  useEffect(() => {
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = () => {
    if (reason && reasonRequired && !reasonValue.trim()) {
      setReasonError('This field is required.');
      return;
    }
    onConfirm(reason ? reasonValue.trim() : undefined);
  };

  const isDanger = tone === 'danger';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onClick={loading ? undefined : onCancel}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex items-start gap-3 min-w-0">
            {isDanger ? (
              <span className="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangleIcon className="w-4.5 h-4.5" />
              </span>
            ) : null}
            <h2 id="confirm-dialog-title" className="text-base font-bold text-slate-900 pt-1.5">
              {title}
            </h2>
          </div>
          <button
            onClick={onCancel}
            disabled={loading}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 shrink-0"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-2 pb-1">
          <p id="confirm-dialog-description" className="text-sm text-slate-500">
            {description}
          </p>

          {reason ? (
            <div className="mt-3">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                {reason.label}
                {reasonRequired ? ' *' : ''}
              </label>
              <textarea
                autoFocus
                rows={3}
                value={reasonValue}
                onChange={(e) => {
                  setReasonValue(e.target.value);
                  if (reasonError) setReasonError('');
                }}
                placeholder={reason.placeholder}
                disabled={loading}
                className="w-full px-3 py-2 text-sm text-slate-900 border border-slate-200 rounded-lg focus:outline-none focus:border-[#5B45B5] focus:ring-2 focus:ring-[#5B45B5]/10 disabled:opacity-60"
              />
              {reasonError ? <p className="text-xs text-red-600 mt-1">{reasonError}</p> : null}
            </div>
          ) : null}
          {error ? <p className="text-xs text-red-600 mt-3">{error}</p> : null}
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm disabled:opacity-60 ${
              isDanger ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-[#5B45B5] text-white hover:bg-[#4E3BA3]'
            }`}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
