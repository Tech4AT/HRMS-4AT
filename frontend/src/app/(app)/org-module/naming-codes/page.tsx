'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth/useAuth';
import { namingCodeDefaults } from '@/lib/mock/org/phase3';
import { PageHeader } from '@/components/org-module/ui';

export default function NamingCodesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('org.manage') || hasPermission('employees.write');
  const [saved, setSaved] = useState(false);

  return (
    <div>
      <PageHeader
        title="Naming / Codes"
        subtitle="Code conventions for every master (mock values, stub save)."
      />

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-w-2xl">
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900">Prefix & sequence conventions</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Examples: IN-LE-01, BU-PRD, DEPT-ENG.
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {namingCodeDefaults.map((f) => (
            <label key={f.key} className="block">
              <span className="block text-xs font-semibold text-slate-600">{f.label}</span>
              {f.options ? (
                <select
                  defaultValue={f.value}
                  disabled={!canManage}
                  aria-label={f.label}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 disabled:opacity-60"
                >
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  defaultValue={f.value}
                  disabled={!canManage}
                  aria-label={f.label}
                  className="mt-1 block w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 disabled:opacity-60"
                />
              )}
              {f.hint ? <span className="block text-[11px] text-slate-400 mt-1">{f.hint}</span> : null}
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
          {saved ? (
            <span className="text-xs font-semibold text-emerald-700">
              Saved (stub — nothing persisted).
            </span>
          ) : null}
          {canManage ? (
            <button
              type="button"
              onClick={() => {
                // eslint-disable-next-line no-console
                console.log('[org-module stub] Naming / Codes saved (no persistence)');
                setSaved(true);
              }}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              Save
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
