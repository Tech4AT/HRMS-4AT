'use client';

import type { ReactNode } from 'react';
import { Button, Icons, toast } from '../ui';
import { payrollApi } from '@/lib/payroll/api';

export interface StepProps {
  period: any;
  periodId: string;
  reload: () => void;
  go: (step: string) => void;
  next: () => void;
  locked: boolean;
  periodLocked: boolean;
}

export function StepHeader({ number, title, subtitle, actions }: { number: number | string; title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-blue-600 text-lg font-bold text-blue-700">{number}</span>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Back / Save & Continue footer: marks the step completed on the period. */
export function StepFooter({ props, step, back, onBeforeContinue, continueLabel = 'Save & Continue' }: {
  props: StepProps; step: string; back?: string; onBeforeContinue?: () => Promise<void>; continueLabel?: string;
}) {
  return (
    <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4">
      <Button onClick={() => (back ? props.go(back) : (window.location.href = `/payroll?period=${props.periodId}`))}>
        <Icons.arrowLeft className="h-4 w-4" /> {back ? 'Back' : 'Back to Payroll'}
      </Button>
      {!props.locked && (
        <Button variant="primary" className="px-6" onClick={async () => {
          try {
            if (onBeforeContinue) await onBeforeContinue();
            await payrollApi.post(`periods/${props.periodId}/steps`, { step, status: 'completed' });
            props.reload();
            props.next();
          } catch (e) { toast.error(e); }
        }}>
          {continueLabel} <Icons.arrowRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export function LockedNotice({ locked }: { locked: boolean }) {
  if (!locked) return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
      <Icons.lock className="h-4 w-4" /> This payroll is finalized and locked. Changes need a privileged reopen with a reason.
    </div>
  );
}
