'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AttendanceStep } from '@/components/payroll/run/AttendanceStep';
import { CompletedStep, FinalizeStep } from '@/components/payroll/run/FinalizeSteps';
import { HoldsStep, StatutoryStep } from '@/components/payroll/run/HoldsStatutory';
import { InputsStep } from '@/components/payroll/run/InputsStep';
import { JoinersExitsStep } from '@/components/payroll/run/JoinersExitsStep';
import { ReviewStep } from '@/components/payroll/run/ReviewStep';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import { Badge, ErrorBanner, Icons, Spinner, Stepper, fmtDate, monthLong, useLoad } from '@/components/payroll/ui';
import { payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

const RUN_STEPS = [
  { key: 'attendance', label: 'Attendance, Leave & Timesheets' },
  { key: 'joiners_exits', label: 'New Joiners & Exits' },
  { key: 'revisions_variable', label: 'Salary Revisions, Bonus & OT' },
  { key: 'reimbursements', label: 'Reimbursements & Deductions' },
  { key: 'holds_adjustments', label: 'Holds, Arrears & Adjustments' },
  { key: 'statutory', label: 'Statutory Deductions' },
  { key: 'review', label: 'Review & Finalize' },
];

export default function RunWizardPage() {
  const { periodId } = useParams<{ periodId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const step = params.get('step') || 'attendance';
  const { can } = usePayrollMeta();
  const { data: period, error, loading, reload } = useLoad(() => payrollApi.get<any>(`periods/${periodId}`).then((r) => r.data), [periodId]);

  if (loading && !period) return <><PayrollTopBar /><Spinner /></>;
  if (error) return <><PayrollTopBar /><ErrorBanner error={error} /></>;

  const locked = period.status === 'finalized' || period.status === 'completed';
  const go = (key: string) => router.push(`/payroll/run/${periodId}?step=${key}`);
  const index = RUN_STEPS.findIndex((s) => s.key === step);
  const stepperSteps = step === 'completed' || step === 'finalize'
    ? [...RUN_STEPS.slice(0, 6).map((s) => ({ ...s, status: 'completed' })), { key: 'review', label: 'Review & Finalize', status: step === 'completed' ? 'completed' : null },
      ...(step === 'completed' ? [{ key: 'completed', label: 'Completed', status: null }] : [])]
    : RUN_STEPS.map((s) => ({ ...s, status: period.step_status?.[s.key] ?? null }));
  const next = () => (index < RUN_STEPS.length - 1 ? go(RUN_STEPS[index + 1].key) : null);
  // Read-only for roles that cannot prepare payroll (reviewers, approvers, auditors);
  // their approve/reject actions are gated separately.
  const ctx = { period, periodId, reload, go, next, locked: locked || !can('payroll.process'), periodLocked: locked };
  const label = step === 'finalize' ? 'Finalize Payroll' : step === 'completed' ? 'Payroll Completed' : RUN_STEPS[index]?.label;

  return (
    <>
      <PayrollTopBar />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link href="/payroll" className="hover:text-blue-700">Payroll</Link><Icons.chevronRight className="h-3.5 w-3.5" />
          <Link href={`/payroll?period=${periodId}`} className="hover:text-blue-700">{monthLong(period.year, period.month)}</Link><Icons.chevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-slate-800">{label}</span>
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700">
            <Icons.calendar className="h-4 w-4" />{fmtDate(period.start_date)} – {fmtDate(period.end_date)}
          </span>
          <span className="text-slate-500">Pay Date: {fmtDate(period.pay_date)}</span>
          <Badge status={period.status} label={period.status_label} />
        </div>
      </div>
      <Stepper steps={stepperSteps} current={step === 'finalize' ? 'review' : step} onSelect={(k) => go(k)} />
      {step === 'attendance' && <AttendanceStep {...ctx} />}
      {step === 'joiners_exits' && <JoinersExitsStep {...ctx} />}
      {step === 'revisions_variable' && <InputsStep {...ctx} variant="variable" />}
      {step === 'reimbursements' && <InputsStep {...ctx} variant="reimbursements" />}
      {step === 'holds_adjustments' && <HoldsStep {...ctx} />}
      {step === 'statutory' && <StatutoryStep {...ctx} />}
      {step === 'review' && <ReviewStep {...ctx} />}
      {step === 'finalize' && <FinalizeStep {...ctx} />}
      {step === 'completed' && <CompletedStep {...ctx} />}
    </>
  );
}
