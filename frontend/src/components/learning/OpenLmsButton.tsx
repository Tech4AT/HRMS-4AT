'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { LearningApiError, openLms } from '@/lib/api/learning';

/** "Open LMS" — single sign-on hand-off to the LMS in a new tab. */
export function OpenLmsButton({ target, label = 'Open LMS' }: { target?: string; label?: string }) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermission('lms.launch')) return null;

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await openLms(target);
    } catch (e) {
      setError(
        e instanceof LearningApiError && e.code === 'LMS_SSO_NOT_CONFIGURED'
          ? 'LMS sign-in is not set up yet. Please contact HR.'
          : e instanceof Error
            ? e.message
            : 'Could not open the LMS.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start sm:items-end gap-1">
      <button
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:bg-purple-300 transition-colors"
      >
        {busy ? 'Opening…' : label}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
        </svg>
      </button>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
