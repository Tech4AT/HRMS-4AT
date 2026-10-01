'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert, Avatar, Badge, Button, Card, Icons, ReasonDialog, Select, Spinner, StatCard, Tabs, Textarea, cx,
  fmtDate, fmtDateTime, inr, monthLong, toast, useLoad,
} from '../ui';
import { downloadText, idempotencyKey, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';
import { StepHeader, type StepProps } from './common';

const CHECK_ICON: Record<string, [keyof typeof Icons, string]> = {
  register: ['file', 'bg-blue-50 text-blue-600'], approvals: ['users', 'bg-violet-50 text-violet-600'], lock: ['lock', 'bg-rose-50 text-rose-600'],
  payslips: ['file', 'bg-emerald-50 text-emerald-600'], payments: ['bank', 'bg-blue-50 text-blue-600'], statutory: ['file', 'bg-amber-50 text-amber-600'],
  journal: ['report', 'bg-violet-50 text-violet-600'],
};

function useRun(runId?: string) {
  const run = useLoad(() => (runId ? payrollApi.get<any>(`runs/${runId}`).then((r) => r.data) : Promise.resolve(null)), [runId]);
  const checklist = useLoad(() => (runId ? payrollApi.get<any[]>(`runs/${runId}/checklist`).then((r) => r.data) : Promise.resolve([])), [runId]);
  const outputs = useLoad(() => (runId ? payrollApi.get<any[]>(`runs/${runId}/outputs`).then((r) => r.data) : Promise.resolve([])), [runId]);
  const payslips = useLoad(() => (runId ? payrollApi.get<any[]>(`runs/${runId}/payslips`).then((r) => r.data) : Promise.resolve([])), [runId]);
  const reloadAll = () => { run.reload(); checklist.reload(); outputs.reload(); payslips.reload(); };
  return { run, checklist, outputs, payslips, reloadAll };
}

function finalizedRunId(period: any, runs: any[] | null) {
  return runs?.find((r) => r.status === 'finalized')?.id ?? period.current_run?.id;
}

/** Finalize Payroll (UI 10). */
export function FinalizeStep(props: StepProps) {
  const { period, periodId } = props;
  const { can } = usePayrollMeta();
  const runs = useLoad(() => payrollApi.get<any[]>(`runs?period=${periodId}`).then((r) => r.data), [periodId, period.status]);
  const runId = finalizedRunId(period, runs.data);
  const { run, checklist, outputs, payslips, reloadAll } = useRun(runId);
  const [busy, setBusy] = useState<string | null>(null);
  if (runs.loading || run.loading || !run.data) return <Spinner />;
  const r = run.data;
  const finalized = r.status === 'finalized';

  const action = async (key: string, fn: () => Promise<any>, message: string) => {
    setBusy(key);
    try { await fn(); toast.success(message); reloadAll(); props.reload(); }
    catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const finalize = () => action('finalize', () => payrollApi.post(`runs/${r.id}/finalize`, {}, { 'Idempotency-Key': idempotencyKey() }), 'Payroll finalized and locked');
  const genPayslips = () => action('payslips', () => payrollApi.post(`runs/${r.id}/payslips/generate`, {}), 'Payslips generated');
  const genOutput = (kind: string) => action(kind, () => payrollApi.post(`runs/${r.id}/outputs`, { kind }), 'File generated');
  const buttons: Record<string, { label: string; onClick?: () => void; href?: string; disabled?: boolean }> = {
    register: { label: 'View Register', href: `/payroll/reports?period=${periodId}&report=register` },
    approvals: { label: 'View Approvals', href: `/payroll/run/${periodId}?step=review` },
    lock: { label: finalized ? 'Locked' : 'Lock Payroll', onClick: finalize, disabled: finalized || r.status !== 'approved' || !can('payroll.finalize') },
    payslips: { label: 'Generate Payslips', onClick: genPayslips, disabled: !finalized || !can('payroll.release') },
    payments: { label: 'Generate Bank File', onClick: () => genOutput('bank_advice'), disabled: !finalized || !can('payroll.release') },
    statutory: { label: 'Generate Reports', onClick: () => ['statutory_pf', 'statutory_esi', 'statutory_pt', 'statutory_tds', 'statutory_lwf'].forEach(genOutput), disabled: !finalized || !can('payroll.release') },
    journal: { label: 'Export Journal', onClick: () => genOutput('journal'), disabled: !finalized || !can('payroll.release') },
  };
  const employer = Number(r.employer_cost_total) - Number(r.gross_total);

  return (
    <div>
      <StepHeader number={7} title="Finalize Payroll"
        subtitle={finalized ? `Payroll is locked. Complete the post-payroll actions for ${monthLong(period.year, period.month)}.` : r.error_count ? 'Resolve blocking errors before finalizing.' : `Everything looks good! Review the summary below and finalize the ${monthLong(period.year, period.month)} payroll.`} />
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Employees" value={r.employee_count} icon={Icons.users} tone="blue" />
        <StatCard label="Gross Payroll" value={inr(r.gross_total)} icon={Icons.money} tone="green" />
        <StatCard label="Total Deductions" value={inr(r.deduction_total)} icon={Icons.pie} tone="blue" />
        <StatCard label="Net Pay" value={inr(r.net_total)} icon={Icons.hand} tone="green" />
        <StatCard label="Payroll Cost (CTC)" value={inr(r.employer_cost_total)} icon={Icons.bank} tone="purple" />
      </div>
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className={cx('flex items-center gap-3 rounded-lg px-4 py-3', r.error_count ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800')}>
          {r.error_count ? <Icons.error className="h-7 w-7" /> : <Icons.check className="h-7 w-7" />}
          <div><div className="font-semibold">{r.error_count ? `${r.error_count} blocking errors` : 'No blocking errors'}</div><div className="text-sm">{r.error_count ? 'Cannot finalize' : 'Ready to finalize'}</div></div>
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-amber-800"><Icons.alert className="h-7 w-7" /><div><div className="font-semibold">{r.warning_count} warnings</div><div className="text-sm">Reviewed & acknowledged</div></div></div>
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 text-blue-800"><Icons.info className="h-7 w-7" /><div><div className="font-semibold">{r.approvals.filter((a: any) => a.status === 'pending').length} pending approvals</div><div className="text-sm">{r.status_label}</div></div></div>
        <Link href={`/payroll/run/${periodId}?step=review&tab=exceptions`} className="flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-blue-700">View Exceptions →</Link>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><Icons.file className="h-5 w-5 text-blue-700" /> Finalization Checklist <span className="text-sm font-normal text-slate-500">Ensure all steps are completed before finalizing payroll.</span></span>}>
            <ol className="divide-y divide-slate-100">
              {(checklist.data ?? []).map((c: any, i: number) => {
                const [icon, tone] = CHECK_ICON[c.key] ?? ['file', 'bg-slate-100'];
                const Icon = Icons[icon];
                const b = buttons[c.key];
                return (
                  <li key={c.key} className="flex items-center gap-4 py-3">
                    <span className={cx('flex h-9 w-9 items-center justify-center rounded-lg', tone)}><Icon className="h-5 w-5" /></span>
                    <span className="w-48 font-semibold text-slate-900">{i + 1}. {c.label}</span>
                    <span className="flex-1 text-sm text-slate-500">{CHECK_TEXT[c.key]}</span>
                    <Badge status={c.status} />
                    {b.href ? <Link href={b.href} className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium">{b.label}</Link>
                      : <Button className="w-40" onClick={b.onClick} disabled={b.disabled} loading={busy === c.key}>{b.label}</Button>}
                  </li>
                );
              })}
            </ol>
          </Card>
          <PostPayrollActions run={r} outputs={outputs.data ?? []} payslips={payslips.data ?? []} onChanged={reloadAll} disabled={!finalized} />
        </div>
        <div className="space-y-5">
          <Card title="Payroll Summary" actions={<Link href={`/payroll/reports?period=${periodId}&report=register`} className="text-sm text-blue-700">View Detailed Report</Link>}>
            <dl className="space-y-2 text-sm">
              {[['Total Employees', r.employee_count], ['Gross Pay', inr(r.gross_total)], ['Total Deductions', inr(r.deduction_total)], ['Net Pay', inr(r.net_total)],
                ['Employer Contributions', inr(employer)], ['Total Payroll Cost (CTC)', inr(r.employer_cost_total)]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-slate-600">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-slate-500">Pay Date</div><div className="text-lg font-bold">{fmtDate(period.pay_date)}</div></div>
              <div><div className="text-slate-500">Payment Mode</div><div className="text-lg font-bold">Bank Transfer</div></div>
            </div>
          </Card>
          <Alert tone="green" title="Employees will be notified">Payslips become available in My Finances once released.</Alert>
          {!finalized && (
            <Button variant="primary" className="w-full py-3 text-base" loading={busy === 'finalize'} disabled={r.status !== 'approved' || !can('payroll.finalize')} onClick={finalize}>
              <Icons.lock className="h-5 w-5" /> Finalize Payroll
            </Button>
          )}
          {!finalized && r.status !== 'approved' && <p className="text-center text-xs text-slate-500">Finalization needs all approval stages complete and no blocking errors.</p>}
          {!finalized && !can('payroll.finalize') && <p className="text-center text-xs text-slate-500">Your role cannot finalize payroll.</p>}
          {finalized && <Button variant="primary" className="w-full py-3" onClick={() => props.go('completed')}>Go to Payroll Completed →</Button>}
        </div>
      </div>
    </div>
  );
}

const CHECK_TEXT: Record<string, string> = {
  register: 'Verify gross, deductions, net pay and exceptions.',
  approvals: 'Submit for approval and get necessary approvals.',
  lock: 'Lock the payroll to prevent further changes.',
  payslips: 'Generate and publish payslips to employees.',
  payments: 'Generate bank advice / payment file.',
  statutory: 'Generate PF, ESI, PT, TDS, LWF reports.',
  journal: 'Export payroll journal for accounting system.',
};

function PostPayrollActions({ run, outputs, payslips, onChanged, disabled }: { run: any; outputs: any[]; payslips: any[]; onChanged: () => void; disabled: boolean }) {
  const { can } = usePayrollMeta();
  const current = (kind: string) => outputs.find((o) => o.kind === kind && o.status !== 'superseded');
  const released = payslips.filter((p) => p.status === 'released').length;
  const run_ = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast.success(msg); onChanged(); } catch (e) { toast.error(e); } };
  const download = async (o: any) => { const r = await payrollApi.get<any>(`outputs/${o.id}/download`); downloadText(r.data.file_name, r.data.content); };
  const statutory = outputs.filter((o) => o.kind.startsWith('statutory_') && o.status !== 'superseded');
  const tiles = [
    { title: 'Payslip Release', text: 'Publish payslips to employees via ESS.', icon: Icons.file, tone: 'bg-blue-50 text-blue-600',
      button: released ? `Released (${released})` : payslips.length ? 'Release Payslips' : 'Generate first',
      onClick: () => run_(() => payrollApi.post(`runs/${run.id}/payslips/release`, {}), 'Payslips released to employees'), disabled: disabled || !payslips.length || !can('payroll.release') },
    { title: 'Bank Advice / Payment File', text: 'Generate bank file for salary payments.', icon: Icons.bank, tone: 'bg-blue-50 text-blue-600',
      button: current('bank_advice') ? 'Download File' : 'Generate File',
      onClick: () => (current('bank_advice') ? download(current('bank_advice')) : run_(() => payrollApi.post(`runs/${run.id}/outputs`, { kind: 'bank_advice' }), 'Bank file generated')), disabled: disabled || !can('payroll.release') },
    { title: 'Statutory Compliance', text: 'Generate PF, ESI, PT, TDS, LWF returns.', icon: Icons.file, tone: 'bg-rose-50 text-rose-600',
      button: statutory.length ? `Download (${statutory.length})` : 'Generate Reports',
      onClick: () => (statutory.length ? statutory.forEach(download) : run_(async () => { for (const k of ['statutory_pf', 'statutory_esi', 'statutory_pt', 'statutory_tds', 'statutory_lwf']) await payrollApi.post(`runs/${run.id}/outputs`, { kind: k }); }, 'Statutory reports generated')), disabled: disabled || !can('payroll.release') },
    { title: 'Accounting Export', text: 'Export payroll journal for NetSuite / accounting system.', icon: Icons.report, tone: 'bg-violet-50 text-violet-600',
      button: current('journal') ? 'Download Journal' : 'Export Journal',
      onClick: () => (current('journal') ? download(current('journal')) : run_(() => payrollApi.post(`runs/${run.id}/outputs`, { kind: 'journal' }), 'Journal exported')), disabled: disabled || !can('payroll.release') },
  ];
  return (
    <Card title={<span className="flex items-center gap-2"><Icons.shield className="h-5 w-5 text-blue-700" /> Post Payroll Actions</span>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.title} className="flex flex-col rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-start gap-2"><span className={cx('rounded-lg p-2', t.tone)}><t.icon className="h-5 w-5" /></span>
              <div><div className="text-sm font-semibold">{t.title}</div><div className="text-xs text-slate-500">{t.text}</div></div></div>
            <Button className="mt-auto" onClick={t.onClick} disabled={t.disabled}>{t.button}</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Payroll Completed / Post-Payroll (UI 13). */
export function CompletedStep(props: StepProps) {
  const { period, periodId } = props;
  const { can } = usePayrollMeta();
  const runs = useLoad(() => payrollApi.get<any[]>(`runs?period=${periodId}`).then((r) => r.data), [periodId, period.status]);
  const runId = finalizedRunId(period, runs.data);
  const { run, outputs, payslips, reloadAll } = useRun(runId);
  const [tab, setTab] = useState<'actions' | 'payslips' | 'payments' | 'statutory' | 'accounting' | 'audit'>('actions');
  const [preview, setPreview] = useState<string>('');
  const [reopen, setReopen] = useState(false);
  const [notes, setNotes] = useState(period.notes ?? '');
  const audit = useLoad(() => (tab === 'audit' && can('payroll.audit') ? payrollApi.get<any[]>(`audit?limit=100`).then((r) => r.data) : Promise.resolve([])), [tab]);
  const slip = useLoad(() => (preview ? payrollApi.get<any>(`payslips/${preview}`).then((r) => r.data) : Promise.resolve(null)), [preview]);
  if (runs.loading || run.loading || !run.data) return <Spinner />;
  const r = run.data;
  if (r.status !== 'finalized') {
    return <Alert tone="amber" title="This payroll is not finalized">{r.status === 'reopened' ? `Reopened: ${r.reopen_reason}. Recalculate, re-approve and finalize again.` : 'Finalize the payroll first.'}</Alert>;
  }
  const bank = outputs.data?.find((o) => o.kind === 'bank_advice' && o.status !== 'superseded');
  const journal = outputs.data?.find((o) => o.kind === 'journal' && o.status !== 'superseded');
  const statutory = (outputs.data ?? []).filter((o) => o.kind.startsWith('statutory_') && o.status !== 'superseded');
  const slips = payslips.data ?? [];
  const released = slips.filter((s) => s.status === 'released');
  const download = async (o: any) => { const d = await payrollApi.get<any>(`outputs/${o.id}/download`); downloadText(d.data.file_name, d.data.content); };
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast.success(msg); reloadAll(); props.reload(); } catch (e) { toast.error(e); } };
  const p = slip.data?.payload;

  const Row = ({ n, icon: Icon, title, text, done, doneText, children }: any) => (
    <div className="flex items-center gap-4 border-b border-slate-100 py-4 last:border-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{n}</span>
      <span className="rounded-lg bg-blue-50 p-2.5 text-blue-600"><Icon className="h-6 w-6" /></span>
      <div className="w-56"><div className="font-semibold text-slate-900">{title}</div><div className="text-sm text-slate-500">{text}</div></div>
      <div className={cx('flex-1 rounded-lg px-4 py-2 text-sm', done ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-500')}>
        {done ? <><div className="font-semibold">✓ {doneText[0]}</div><div className="text-xs">{doneText[1]}</div></> : 'Not generated yet'}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-emerald-50 px-6 py-5">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white"><Icons.check className="h-7 w-7" /></span>
          <div><h2 className="text-2xl font-bold text-slate-900">{monthLong(period.year, period.month)} Payroll {period.status === 'completed' ? 'Completed!' : 'Finalized'}</h2>
            <p className="text-sm text-emerald-800">Payroll was processed and locked on {fmtDateTime(r.finalized_at)} by {r.finalized_by?.name}.</p></div>
        </div>
        <div className="flex gap-2">
          <Link href={`/payroll/reports?period=${periodId}&report=register`} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">View Payroll Summary</Link>
          {can('payroll.reopen') && <Button variant="primary" onClick={() => setReopen(true)}><Icons.refresh className="h-4 w-4" /> Re-open Payroll</Button>}
        </div>
      </div>
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Employees" value={r.employee_count} icon={Icons.users} tone="blue" />
        <StatCard label="Gross Payroll" value={inr(r.gross_total)} icon={Icons.money} tone="green" />
        <StatCard label="Total Deductions" value={inr(r.deduction_total)} icon={Icons.pie} tone="blue" />
        <StatCard label="Net Pay" value={inr(r.net_total)} icon={Icons.hand} tone="green" />
        <StatCard label="Payroll Cost (CTC)" value={inr(r.employer_cost_total)} icon={Icons.bank} tone="purple" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_400px]">
        <Card>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'actions', label: 'Post Payroll Actions' }, { key: 'payslips', label: 'Payslips' }, { key: 'payments', label: 'Payments' },
            { key: 'statutory', label: 'Statutory Compliance' }, { key: 'accounting', label: 'Accounting' }, { key: 'audit', label: 'Audit Trail' }]} />
          {tab === 'actions' && (
            <div>
              <Row n={1} icon={Icons.file} title="Payslips" text="Generate and release payslips to employees via ESS." done={slips.length > 0}
                doneText={[released.length ? 'Payslips Released' : 'Payslips Generated', `${slips.length} payslips · ${released.length} released`]}>
                <Button onClick={() => act(() => payrollApi.post(`runs/${r.id}/payslips/generate`, {}), 'Payslips generated')} disabled={!can('payroll.release')}>{slips.length ? 'Regenerate' : 'Generate'}</Button>
                <Button variant="primary" onClick={() => act(() => payrollApi.post(`runs/${r.id}/payslips/release`, {}), 'Payslips released to ESS')} disabled={!slips.length || !can('payroll.release')}>Send to ESS</Button>
              </Row>
              <Row n={2} icon={Icons.bank} title="Payments" text="Generate bank advice / payment file for salary disbursement." done={!!bank}
                doneText={[bank?.status === 'paid' ? 'Marked as Paid' : 'Payment File Generated', bank ? `v${bank.version} · ${fmtDateTime(bank.generated_at)} · ${inr(bank.total_amount)} (${bank.record_count} employees)` : '']}>
                {bank ? <Button onClick={() => download(bank)}><Icons.download className="h-4 w-4" /> Download File</Button>
                  : <Button onClick={() => act(() => payrollApi.post(`runs/${r.id}/outputs`, { kind: 'bank_advice' }), 'Bank file generated')} disabled={!can('payroll.release')}>Generate</Button>}
                <Button variant="primary" disabled={!bank || bank.status === 'paid' || !can('payroll.release')} onClick={() => act(() => payrollApi.post(`outputs/${bank.id}/mark-paid`, {}), 'Marked as paid')}>Mark as Paid</Button>
              </Row>
              <Row n={3} icon={Icons.file} title="Statutory Compliance" text="Generate PF, ESI, PT, TDS, LWF reports." done={statutory.length > 0}
                doneText={['Reports Generated', `Ready for filing: ${statutory.map((o) => o.kind.replace('statutory_', '').toUpperCase()).join(', ')}`]}>
                {statutory.length ? <Button onClick={() => statutory.forEach(download)}><Icons.download className="h-4 w-4" /> Download Reports</Button>
                  : <Button onClick={() => act(async () => { for (const k of ['statutory_pf', 'statutory_esi', 'statutory_pt', 'statutory_tds', 'statutory_lwf']) await payrollApi.post(`runs/${r.id}/outputs`, { kind: k }); }, 'Reports generated')} disabled={!can('payroll.release')}>Generate</Button>}
              </Row>
              <Row n={4} icon={Icons.report} title="Accounting Export" text="Export payroll journal for accounting system (e.g., NetSuite)." done={!!journal}
                doneText={['Journal Exported', journal ? `File generated on ${fmtDateTime(journal.generated_at)} · Format: CSV · ${journal.record_count} entries` : '']}>
                {journal ? <Button onClick={() => download(journal)}><Icons.download className="h-4 w-4" /> Download Journal</Button>
                  : <Button onClick={() => act(() => payrollApi.post(`runs/${r.id}/outputs`, { kind: 'journal' }), 'Journal exported')} disabled={!can('payroll.release')}>Export</Button>}
              </Row>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
                <div className="rounded-lg border border-slate-200 p-3 text-sm"><div className="text-slate-500">Completed By</div>
                  <div className="mt-1 flex items-center gap-2"><Avatar name={r.finalized_by?.name} /><div><div className="font-semibold">{r.finalized_by?.name}</div><div className="text-xs text-slate-500">{fmtDateTime(r.finalized_at)}</div></div></div></div>
                <div className="rounded-lg border border-slate-200 p-3"><div className="mb-1 text-sm text-slate-500">Notes (Optional)</div>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Payroll processed as per approved inputs. No blocking issues." /></div>
              </div>
            </div>
          )}
          {tab === 'payslips' && (
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
              {slips.map((s) => (<tr key={s.id} className="hover:bg-slate-50"><td className="py-2">{s.employee.name} <span className="text-xs text-slate-400">{s.employee.employee_code}</span></td>
                <td className="py-2 text-right">{inr(s.net_pay)}</td><td className="py-2 pl-4"><Badge status={s.status} /></td>
                <td className="py-2 text-right"><Link className="text-blue-700" href={`/payroll/payslips/${s.id}`}>Open</Link></td></tr>))}
              {!slips.length && <tr><td className="py-6 text-center text-slate-500">No payslips generated yet.</td></tr>}
            </tbody></table>
          )}
          {(tab === 'payments' || tab === 'statutory' || tab === 'accounting') && (
            <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">
              {(outputs.data ?? []).filter((o) => (tab === 'payments' ? o.kind === 'bank_advice' : tab === 'accounting' ? o.kind === 'journal' : o.kind.startsWith('statutory_'))).map((o) => (
                <tr key={o.id}><td className="py-2">{o.kind_label} v{o.version}</td><td className="py-2">{o.file_name}</td><td className="py-2 text-right">{inr(o.total_amount)}</td>
                  <td className="py-2 pl-3"><Badge status={o.status} /></td><td className="py-2 text-xs text-slate-500">{fmtDateTime(o.generated_at)} · {o.generated_by?.name}</td>
                  <td className="py-2 text-right"><button className="text-blue-700" onClick={() => download(o)}>Download</button></td></tr>
              ))}
            </tbody></table>
          )}
          {tab === 'audit' && (
            <ul className="space-y-2 text-sm">{(audit.data ?? []).map((a: any) => (
              <li key={a.id} className="flex gap-3 border-b border-slate-100 pb-2"><span className="w-40 shrink-0 text-xs text-slate-500">{fmtDateTime(a.created_at)}</span>
                <span className="w-40 shrink-0">{a.actor}</span><span className="flex-1">{a.action.replace(/[._]/g, ' ')}<span className="block text-xs text-slate-500">{a.summary}</span></span></li>))}
              {!can('payroll.audit') && <li className="text-slate-500">The audit trail needs the payroll audit permission.</li>}
            </ul>
          )}
        </Card>
        <Card title="Employee Payslip Preview" actions={released[0] && <Link href={`/payroll/payslips/${preview || released[0].id}`} className="text-sm text-blue-700">View full →</Link>}>
          <Select value={preview} onChange={(e) => setPreview(e.target.value)} placeholder="Choose an employee"
            options={slips.map((s) => ({ value: s.id, label: `${s.employee.name} (${s.employee.employee_code})` }))} />
          {p ? (
            <div className="mt-4 space-y-3 text-sm">
              <div><div className="font-bold">{p.company.name}</div><div className="text-slate-500">Payslip – {p.period.label}</div></div>
              <div className="grid grid-cols-4 gap-2 text-xs"><div><div className="text-slate-500">Pay Period</div>{fmtDate(p.period.start)} – {fmtDate(p.period.end)}</div>
                <div><div className="text-slate-500">Pay Date</div>{fmtDate(p.period.pay_date)}</div><div><div className="text-slate-500">Working Days</div>{p.working_days}</div><div><div className="text-slate-500">Payable Days</div>{p.payable_days}</div></div>
              <div className="grid grid-cols-2 gap-2">
                <MiniTable title="Earnings" tone="bg-emerald-50" lines={p.earnings} total={p.gross} totalLabel="Total Earnings (A)" />
                <MiniTable title="Deductions" tone="bg-rose-50" lines={p.deductions} total={p.total_deductions} totalLabel="Total Deductions (B)" />
              </div>
              <div className="flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-base font-bold"><span>Net Pay (A - B)</span><span>{inr(p.net_pay)}</span></div>
            </div>
          ) : <p className="mt-4 text-sm text-slate-500">{slips.length ? 'Choose an employee to preview their payslip.' : 'Generate payslips to preview them.'}</p>}
        </Card>
      </div>
      <div className="mt-6 flex justify-between border-t border-slate-200 pt-4">
        <Link href="/payroll" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">← Back to Payroll</Link>
        <div className="flex gap-2">
          <Button onClick={() => window.print()}><Icons.printer className="h-4 w-4" /> Print Summary</Button>
          {period.status !== 'completed' && can('payroll.release') && (
            <Button variant="primary" onClick={() => act(() => payrollApi.post(`periods/${periodId}/complete`, { notes }), 'Payroll closed')}>✓ Close Payroll</Button>
          )}
        </div>
      </div>
      <ReasonDialog open={reopen} title="Re-open finalized payroll" requireReason="Reason (mandatory, audited)" variant="danger" confirmLabel="Re-open"
        message="Reopening unlocks the period. Generated payslips and files are marked superseded (kept for audit); recalculate, re-approve and finalize again."
        onClose={() => setReopen(false)} onConfirm={async (reason) => { await act(() => payrollApi.post(`runs/${r.id}/reopen`, { reason }), 'Payroll reopened'); setReopen(false); props.go('review'); }} />
    </div>
  );
}

function MiniTable({ title, tone, lines, total, totalLabel }: { title: string; tone: string; lines: any[]; total: string; totalLabel: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 text-xs">
      <div className={cx('px-2 py-1.5 font-semibold', tone)}>{title}</div>
      {lines.map((l) => <div key={l.code} className="flex justify-between px-2 py-1"><span>{l.name}</span><span>{Number(l.amount).toLocaleString('en-IN')}</span></div>)}
      <div className="flex justify-between border-t border-slate-200 px-2 py-1.5 font-semibold"><span>{totalLabel}</span><span>{Number(total).toLocaleString('en-IN')}</span></div>
    </div>
  );
}
