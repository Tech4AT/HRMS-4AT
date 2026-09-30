'use client';

import { useState, type ReactNode } from 'react';
import { leaveApi, LeaveApiError, type LeaveType } from '@/lib/api/leave';

export type LeaveTypeDialogKind = 'delete' | 'blocked' | 'deactivate' | 'purge';

/** Delete what is unused, deactivate what has history, and (deliberately, behind a
 *  typed confirmation) purge a type together with its records. Every failure is
 *  shown in the dialog that caused it, never swallowed. */
export function usageOf(t: LeaveType): { balances: number; requests: number; inUse: boolean } {
  const balances = t.balance_count ?? 0;
  const requests = t.request_count ?? 0;
  return { balances, requests, inUse: balances + requests > 0 };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function usageSentence(t: LeaveType): string {
  const { balances, requests } = usageOf(t);
  return `${plural(balances, 'employee balance', 'employee balances')} and ${plural(requests, 'leave request', 'leave requests')}`;
}

function Shell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

const CANCEL_CLS = 'text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50';
const PRIMARY_CLS = 'text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed';
const DANGER_CLS = 'text-sm font-semibold px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed';

export function LeaveTypeDialog({
  kind,
  type,
  onSwitch,
  onClose,
  onDone,
}: {
  kind: LeaveTypeDialogKind;
  type: LeaveType;
  /** Move to another dialog for the same type (e.g. blocked -> deactivate). */
  onSwitch: (next: LeaveTypeDialogKind) => void;
  onClose: () => void;
  /** Something changed on the server: reload the list, then close. */
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await action());
    } catch (e) {
      setError(e instanceof LeaveApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const errorLine = error ? (
    <p role="alert" className="text-sm text-red-600 mt-3">
      {error}
    </p>
  ) : null;

  if (kind === 'delete') {
    return (
      <Shell title="Delete leave type?" onClose={onClose}>
        <div className="p-5">
          <h3 className="text-base font-bold text-slate-900">Delete leave type?</h3>
          <p className="text-sm text-slate-500 mt-2">
            &ldquo;{type.name}&rdquo; isn&rsquo;t used by any balance or leave request, so it can be deleted permanently.
          </p>
          {errorLine}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button onClick={onClose} disabled={busy} className={CANCEL_CLS}>
            Cancel
          </button>
          <button
            disabled={busy}
            className={DANGER_CLS}
            onClick={() =>
              run(async () => {
                try {
                  await leaveApi.deleteType(type.id);
                } catch (e) {
                  // It was used after all (someone opened leave since the list loaded).
                  if (e instanceof LeaveApiError && e.status === 409) onSwitch('blocked');
                  throw e;
                }
                return `Deleted “${type.name}”.`;
              })
            }
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Shell>
    );
  }

  if (kind === 'blocked') {
    return (
      <Shell title={`Cannot delete ${type.name}`} onClose={onClose}>
        <div className="p-5">
          <h3 className="text-base font-bold text-slate-900">Cannot delete &ldquo;{type.name}&rdquo;</h3>
          <p className="text-sm text-slate-600 mt-2">
            This leave type is already used by {usageSentence(type)}.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Deleting it would affect historical HR data. You can deactivate it instead: it can&rsquo;t be used for new
            requests, but existing records are preserved.
          </p>
          <button
            onClick={() => onSwitch('purge')}
            className="mt-4 text-xs font-semibold text-red-600 hover:text-red-700 underline underline-offset-2"
          >
            Delete permanently, including all its records&hellip;
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button onClick={onClose} className={CANCEL_CLS}>
            Cancel
          </button>
          {type.status === 'active' ? (
            <button onClick={() => onSwitch('deactivate')} className={PRIMARY_CLS}>
              Deactivate
            </button>
          ) : null}
        </div>
      </Shell>
    );
  }

  if (kind === 'deactivate') {
    return (
      <Shell title={`Deactivate ${type.name}?`} onClose={onClose}>
        <div className="p-5">
          <h3 className="text-base font-bold text-slate-900">Deactivate &ldquo;{type.name}&rdquo;?</h3>
          <p className="text-sm text-slate-500 mt-2">
            It can no longer be chosen for new leave requests. Every existing balance and request keeps its history and
            stays viewable, and you can reactivate it at any time.
          </p>
          {errorLine}
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
          <button onClick={onClose} disabled={busy} className={CANCEL_CLS}>
            Cancel
          </button>
          <button
            disabled={busy}
            className={PRIMARY_CLS}
            onClick={() =>
              run(async () => {
                await leaveApi.setTypeStatus(type.id, 'inactive');
                return `Deactivated “${type.name}”.`;
              })
            }
          >
            {busy ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </Shell>
    );
  }

  // purge
  const matches = typedName === type.name;
  return (
    <Shell title={`Permanently delete ${type.name}`} onClose={onClose}>
      <div className="p-5">
        <h3 className="text-base font-bold text-red-700">Permanently delete &ldquo;{type.name}&rdquo;?</h3>
        <p className="text-sm text-slate-600 mt-2">This cannot be undone. It will erase:</p>
        <ul className="text-sm text-slate-700 mt-2 list-disc pl-5 space-y-1">
          <li>the leave type &ldquo;{type.name}&rdquo;</li>
          <li>{plural(usageOf(type).balances, 'employee balance', 'employee balances')}</li>
          <li>{plural(usageOf(type).requests, 'leave request', 'leave requests')}, and their approvals</li>
        </ul>
        <p className="text-xs text-slate-500 mt-3">
          If the attendance policy uses this type, that setting is cleared. Penalisation history is kept, without its link
          to the erased balance.
        </p>
        <label className="block text-xs font-semibold text-slate-600 mt-4 mb-1">
          Type <span className="font-mono">{type.name}</span> to confirm
        </label>
        <input
          type="text"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          autoFocus
          autoComplete="off"
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        {errorLine}
      </div>
      <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200">
        <button onClick={onClose} disabled={busy} className={CANCEL_CLS}>
          Cancel
        </button>
        <button
          disabled={busy || !matches}
          className={DANGER_CLS}
          onClick={() =>
            run(async () => {
              const r = await leaveApi.purgeType(type.id, typedName);
              return `Permanently deleted “${type.name}” with ${plural(r.balances, 'balance', 'balances')} and ${plural(r.requests, 'request', 'requests')}.`;
            })
          }
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </Shell>
  );
}
