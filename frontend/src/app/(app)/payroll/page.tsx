'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Badge, Button, Card, ErrorBanner, Icons, Modal, Field, Input, Select, Spinner, StatCard, cx, fmtDate,
  fmtDateTime, inrShort, monthLabel, monthLong, toast, useLoad,
} from '@/components/payroll/ui';
import { idempotencyKey, payrollApi, qs } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

const STEP_ICON_TONE: Record<string, string> = {
  completed: 'bg-emerald-600', ready: 'bg-emerald-600', items_to_review: 'bg-amber-500', pending: 'bg-amber-500',
  in_progress: 'bg-blue-600',
};

const STEP_LABEL: Record<string, { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'green' },
  ready: { label: 'Ready', tone: 'green' },
  items_to_review: { label: 'Items to review', tone: 'amber' },
  pending: { label: 'Pending', tone: 'amber' },
  in_progress: { label: 'In Progress', tone: 'blue' },
};

const KPI_STYLE: Record<string, { icon: keyof typeof Icons; tone: any }> = {
  employees: { icon: 'users', tone: 'blue' },
  gross: { icon: 'money', tone: 'green' },
  net: { icon: 'hand', tone: 'green' },
  deductions: { icon: 'pie', tone: 'blue' },
  employer_contributions: { icon: 'bank', tone: 'purple' },
  employer_cost: { icon: 'bank', tone: 'purple' },
};

export default function PayrollDashboardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = usePayrollMeta();
  const [payGroup, setPayGroup] = useState(params.get('pay_group') || '');
  const [periodId, setPeriodId] = useState(params.get('period') || '');
  const [creating, setCreating] = useState<{ year: number; month: number } | null>(null);
  const [processing, setProcessing] = useState(false);

  const { data, error, loading, reload } = useLoad(
    () => payrollApi.get<any>(`dashboard${qs({ pay_group: payGroup, period: periodId })}`).then((r) => r.data),
    [payGroup, periodId],
  );

  if (loading && !data) return <><PayrollTopBar /><Spinner /></>;
  if (error) return <><PayrollTopBar /><ErrorBanner error={error} /></>;
  if (!data?.pay_group) {
    return (
      <>
        <PayrollTopBar />
        <Card title="Set up payroll">
          <p className="text-sm text-slate-600">
            No pay group exists yet. Create one under Configuration → Pay Groups, then add salary components and a structure.
          </p>
          <Link href="/payroll/configuration?tab=pay-groups" className="mt-3 inline-block text-sm font-medium text-blue-700">
            Open configuration →
          </Link>
        </Card>
      </>
    );
  }

  const period = data.period;
  const selectIndex = data.periods.findIndex((p: any) => p.is_selected);

  const shiftPeriods = (delta: number) => {
    const target = data.periods[Math.min(Math.max(selectIndex + delta, 0), data.periods.length - 1)];
    if (target?.id) setPeriodId(target.id);
    else if (target) setCreating({ year: target.year, month: target.month });
  };

  const processPayroll = async () => {
    if (!period) return;
    setProcessing(true);
    try {
      await payrollApi.post(`periods/${period.id}/calculate`, {}, { 'Idempotency-Key': idempotencyKey() });
      toast.success('Payroll calculated. Review employees and exceptions.');
      router.push(`/payroll/run/${period.id}?step=review`);
    } catch (e) {
      toast.error(e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <PayrollTopBar />

      {data.pay_groups.length > 1 && (
        <div className="mb-3 w-64">
          <Select value={data.pay_group.id} onChange={(e) => { setPayGroup(e.target.value); setPeriodId(''); }}
            options={data.pay_groups.map((g: any) => ({ value: g.id, label: g.name }))} />
        </div>
      )}

      {/* Period strip */}
      <div className="mb-6 flex items-stretch gap-3">
        <button onClick={() => shiftPeriods(-1)} className="rounded-lg border border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50" aria-label="Previous period">
          <Icons.chevronLeft className="h-4 w-4" />
        </button>
        {data.periods.map((p: any) => {
          const statusText = p.is_selected ? 'Current' : p.status === 'completed' ? 'Completed' : p.id ? statusLabelFor(p.status)
            : p.status === 'upcoming' ? 'Upcoming' : 'Not created';
          const dot = p.is_selected ? 'bg-blue-600' : p.status === 'completed' ? 'bg-emerald-600' : p.id ? 'bg-amber-500' : 'bg-slate-400';
          return (
            <button key={`${p.year}-${p.month}`}
              onClick={() => (p.id ? setPeriodId(p.id) : setCreating({ year: p.year, month: p.month }))}
              className={cx('flex-1 rounded-xl border px-4 py-3 text-center transition-colors',
                p.is_selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300')}>
              <div className={cx('text-base font-semibold', p.is_selected ? 'text-blue-800' : 'text-slate-800')}>
                {monthLabel(p.year, p.month)}
              </div>
              <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-slate-500">
                {p.status === 'completed' && !p.is_selected ? <Icons.check className="h-4 w-4 text-emerald-600" />
                  : <span className={cx('h-2 w-2 rounded-full', dot)} />}
                {statusText}
              </div>
            </button>
          );
        })}
        <button onClick={() => shiftPeriods(1)} className="rounded-lg border border-slate-200 bg-white px-3 text-slate-600 hover:bg-slate-50" aria-label="Next period">
          <Icons.chevronRight className="h-4 w-4" />
        </button>
      </div>

      {!period ? (
        <Card title="No payroll period yet">
          <p className="text-sm text-slate-600">Create the first payroll period for {data.pay_group.name}.</p>
          <Button variant="primary" className="mt-3"
            onClick={() => { const d = new Date(); setCreating({ year: d.getFullYear(), month: d.getMonth() + 1 }); }}>
            Create period
          </Button>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-bold text-slate-900">{monthLong(period.year, period.month)} Payroll</h2>
                <Badge status={period.status} label={period.status_label} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <span className="flex items-center gap-1.5"><Icons.calendar className="h-4 w-4" />{fmtDate(period.start_date)} – {fmtDate(period.end_date)}</span>
                <span className="text-slate-300">|</span>
                <span className="flex items-center gap-1.5"><Icons.calendar className="h-4 w-4" />Pay Date: {fmtDate(period.pay_date)}</span>
              </div>
            </div>
            <MoreActions period={period} run={data.run} onRefresh={reload} />
          </div>

          {/* KPIs */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {data.kpis.filter((k: any) => k.key !== 'employer_cost').map((k: any) => {
              const style = KPI_STYLE[k.key] ?? { icon: 'money', tone: 'blue' };
              const Icon = Icons[style.icon as keyof typeof Icons];
              const prevLabel = data.periods[selectIndex - 1] ? monthLabel(data.periods[selectIndex - 1].year, data.periods[selectIndex - 1].month) : '';
              return (
                <StatCard key={k.key} label={k.label} icon={Icon} tone={style.tone}
                  value={k.value === null ? '—' : k.key === 'employees' ? k.value : inrShort(k.value)}
                  trend={k.change_pct} sub={k.change_pct !== null && prevLabel ? `vs ${prevLabel}` : k.value === null ? 'Not calculated yet' : undefined} />
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {/* Run payroll checklist */}
            <Card className="xl:col-span-2">
              <h3 className="text-xl font-semibold text-slate-900">Run Payroll</h3>
              <p className="text-sm text-slate-500">Complete the steps below to process {monthLong(period.year, period.month)} payroll</p>
              <ol className="mt-4 divide-y divide-slate-100">
                {data.steps.map((s: any, i: number) => {
                  const st = STEP_LABEL[s.status] ?? STEP_LABEL.ready;
                  return (
                    <li key={s.key}>
                      <Link href={`/payroll/run/${period.id}?step=${s.key}`} className="flex items-center gap-4 py-3.5 hover:bg-slate-50">
                        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', STEP_ICON_TONE[s.status] ?? 'bg-emerald-600')}>
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-slate-900">{s.label}</span>
                          <span className="block text-sm text-slate-500">{STEP_HELP[s.key]}</span>
                        </span>
                        <Badge tone={st.tone} label={st.label} />
                        <span className="hidden w-40 border-l border-slate-200 pl-4 text-sm text-slate-500 md:block">{s.summary}</span>
                        <Icons.chevronRight className="h-4 w-4 text-slate-400" />
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-5 flex flex-wrap gap-3">
                {can('payroll.process') && period.status !== 'finalized' && period.status !== 'completed' && (
                  <Button variant="primary" className="px-8 py-3 text-base" loading={processing} onClick={processPayroll}>
                    Process Payroll <Icons.arrowRight className="h-4 w-4" />
                  </Button>
                )}
                <Link href={`/payroll/run/${period.id}?step=${period.status === 'finalized' || period.status === 'completed' ? 'completed' : 'review'}`}
                  className="rounded-lg border border-blue-900 px-8 py-3 text-base font-medium text-blue-900 hover:bg-blue-50">
                  Review Employees
                </Link>
              </div>
            </Card>

            <div className="space-y-6">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">Payroll Health</h3>
                  <span className="text-xs text-slate-500">As on {fmtDateTime(data.run?.calculated_at ?? new Date().toISOString())}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <HealthTile tone="red" icon={Icons.error} value={data.health.errors} label="Errors" />
                  <HealthTile tone="amber" icon={Icons.alert} value={data.health.warnings} label="Warnings" />
                  <HealthTile tone="green" icon={Icons.check} value={data.health.ready} label="Ready" />
                </div>
                <div className="mt-4 text-sm font-semibold text-slate-800">Key issues to resolve</div>
                <ul className="mt-2 space-y-2 text-sm">
                  {data.health.issues.length === 0 && <li className="text-slate-500">No open issues.</li>}
                  {data.health.issues.map((issue: any) => (
                    <li key={issue.rule_code} className="flex items-start gap-2">
                      {issue.severity === 'blocking' ? <Icons.error className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                        : <Icons.alert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                      <span className="flex-1 text-slate-700">{issue.count} × {issue.message}</span>
                      <Link className="text-blue-700" href={`/payroll/run/${period.id}?step=review&tab=exceptions`}>View</Link>
                    </li>
                  ))}
                </ul>
                <Link href={`/payroll/run/${period.id}?step=review&tab=exceptions`} className="mt-3 flex justify-end text-sm font-medium text-blue-700">
                  View all exceptions →
                </Link>
              </Card>

              <Card>
                <h3 className="mb-3 text-lg font-semibold text-slate-900">Approval Status</h3>
                {data.approvals.length === 0 ? (
                  <p className="text-sm text-slate-500">Not yet submitted for approval.</p>
                ) : (
                  <ol className="space-y-3">
                    {data.approvals.map((a: any, i: number) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                          a.status === 'approved' ? 'bg-emerald-600' : a.status === 'pending' ? 'bg-slate-400' : 'bg-rose-500')}>
                          {a.status === 'approved' ? '✓' : i + 1}
                        </span>
                        <div className="text-sm">
                          <div className="font-medium text-slate-900">{a.stage === 'prepared' ? 'Prepared' : a.label}</div>
                          <div className="text-slate-500">
                            {a.status === 'pending' ? 'Pending' : `${a.approver} · ${fmtDateTime(a.acted_at)}`}
                          </div>
                          {a.comments && a.stage !== 'prepared' && <div className="text-xs text-slate-500">“{a.comments}”</div>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              <Card title="Recent Payroll Activity" actions={can('payroll.audit') ? <Link href="/payroll/reports?tab=audit" className="text-sm text-blue-700">View all</Link> : undefined}>
                <ul className="space-y-3 text-sm">
                  {data.activity.length === 0 && <li className="text-slate-500">No activity yet.</li>}
                  {data.activity.map((a: any) => (
                    <li key={a.id} className="flex items-start gap-3">
                      <span className="mt-0.5 rounded-md bg-emerald-50 p-1.5 text-emerald-600"><Icons.file className="h-4 w-4" /></span>
                      <span className="flex-1">
                        <span className="block text-slate-800">{activityText(a)}</span>
                        <span className="block text-xs text-slate-500">{fmtDateTime(a.created_at)} · by {a.actor}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}

      <CreatePeriodModal open={!!creating} initial={creating} payGroupId={data.pay_group.id}
        onClose={() => setCreating(null)}
        onCreated={(id) => { setCreating(null); setPeriodId(id); reload(); }} />
    </>
  );
}

const STEP_HELP: Record<string, string> = {
  attendance: 'Import attendance, process leave, LOP and overtime',
  joiners_exits: 'Review new joiners, exits and final settlements',
  revisions_variable: 'Process salary changes, bonus, incentives and OT',
  reimbursements: 'Process reimbursements, ad-hoc payments and deductions',
  holds_adjustments: 'Manage holds, arrears and one-time adjustments',
  statutory: 'PF, ESI, PT, TDS, LWF and other statutory components',
};

function statusLabelFor(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function activityText(a: any) {
  const text = a.action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + (a.summary ? ` — ${a.summary}` : '');
}

function HealthTile({ tone, icon: Icon, value, label }: { tone: 'red' | 'amber' | 'green'; icon: any; value: number; label: string }) {
  const styles = { red: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', green: 'bg-emerald-50 text-emerald-700' }[tone];
  return (
    <div className={cx('flex items-center gap-2 rounded-lg px-3 py-3', styles)}>
      <Icon className="h-6 w-6" />
      <div>
        <div className="text-2xl font-bold leading-none">{value}</div>
        <div className="text-sm">{label}</div>
      </div>
    </div>
  );
}

function MoreActions({ period, run, onRefresh }: { period: any; run: any; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button onClick={() => setOpen(!open)}>More actions <Icons.chevronRight className="h-4 w-4 rotate-90" /></Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          <MenuLink href={`/payroll/run/${period.id}?step=attendance`}>Open run wizard</MenuLink>
          {run && <MenuLink href={`/payroll/reports?period=${period.id}&report=register`}>Payroll register</MenuLink>}
          <MenuLink href={`/payroll/reports?tab=audit`}>Audit trail</MenuLink>
          <button className="block w-full px-4 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setOpen(false); onRefresh(); }}>Refresh</button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">{children}</Link>;
}

function CreatePeriodModal({ open, initial, payGroupId, onClose, onCreated }: {
  open: boolean; initial: { year: number; month: number } | null; payGroupId: string; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [payDate, setPayDate] = useState('');
  const [workingDays, setWorkingDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!initial) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Create ${monthLong(initial.year, initial.month)} payroll`}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            const r = await payrollApi.post<any>('periods', {
              pay_group: payGroupId, year: initial.year, month: initial.month,
              pay_date: payDate || undefined, working_days: workingDays || undefined,
            });
            toast.success('Payroll period created');
            onCreated(r.data.id);
          } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Create period</Button>
      </>}>
      <div className="space-y-3">
        <ErrorBanner error={error} />
        <p className="text-sm text-slate-600">The period runs for the calendar month. Leave the fields blank to use the pay group defaults.</p>
        <Field label="Pay date"><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
        <Field label="Working days (for working-day proration)"><Input type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
