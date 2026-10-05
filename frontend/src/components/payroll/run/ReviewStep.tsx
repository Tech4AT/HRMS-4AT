'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Alert, Avatar, Badge, Button, Card, EmployeeCell, Icons, Modal, ReasonDialog, SearchBox, Select, Spinner,
  StatCard, Table, Tabs, Td, Th, cx, downloadCsvRows, fmtDateTime, inr, num, toast, useLoad,
} from '../ui';
import { idempotencyKey, payrollApi, qs } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';
import { LockedNotice, StepHeader, type StepProps } from './common';

type Tab = 'all' | 'exceptions' | 'joiners' | 'exits' | 'revisions' | 'reimbursements' | 'holds';
const PAGE = 10;

/** Step 7 — Review & Finalize Payroll (UI 14). */
export function ReviewStep(props: StepProps) {
  const { period, periodId, locked } = props;
  const { can } = usePayrollMeta();
  const runId = period.current_run?.id;
  const run = useLoad(() => (runId ? payrollApi.get<any>(`runs/${runId}`).then((r) => r.data) : Promise.resolve(null)), [runId]);
  const dash = useLoad(() => payrollApi.get<any>(`dashboard?period=${periodId}`).then((r) => r.data), [periodId, runId]);
  const [tab, setTab] = useState<Tab>((typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'exceptions') ? 'exceptions' : 'all');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const results = useLoad(() => (runId ? payrollApi.get<any[]>(`runs/${runId}/results${qs({ tab: tab === 'all' ? '' : tab, search, department: dept, status })}`) : Promise.resolve(null)),
    [runId, tab, search, dept, status]);
  const [selected, setSelected] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [exceptionsOpen, setExceptionsOpen] = useState(false);
  const [decision, setDecision] = useState<null | 'reject' | 'return'>(null);
  useEffect(() => setPage(1), [tab, search, dept, status]);

  const calculate = async () => {
    setCalculating(true);
    try {
      await payrollApi.post(`periods/${periodId}/calculate`, {}, { 'Idempotency-Key': idempotencyKey() });
      toast.success('Payroll recalculated'); props.reload();
    } catch (e) { toast.error(e); } finally { setCalculating(false); }
  };

  if (!runId) {
    return (
      <div>
        <StepHeader number={7} title="Review & Finalize Payroll" subtitle="Review employee-wise payroll details, resolve exceptions and submit for approval." />
        <Card>
          <div className="py-10 text-center">
            <div className="text-lg font-semibold text-slate-900">Payroll has not been calculated yet</div>
            <p className="mt-1 text-sm text-slate-500">Calculation uses finalized attendance, approved inputs and effective compensation, and stores a trace for every component.</p>
            {can('payroll.process') && !locked && <Button variant="primary" className="mt-4" loading={calculating} onClick={calculate}><Icons.refresh className="h-4 w-4" /> Calculate payroll</Button>}
          </div>
        </Card>
      </div>
    );
  }
  if (run.loading && !run.data) return <Spinner />;
  const r = run.data;
  const counts = r.tab_counts;
  const rows = results.data?.data ?? [];
  const paged = rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const kpi = (key: string) => dash.data?.kpis?.find((k: any) => k.key === key);
  const pendingStage = r.approvals.find((a: any) => a.status === 'pending');
  const canDecide = r.status === 'submitted' && pendingStage && (pendingStage.stage === 'finance_review' ? can('payroll.review') : can('payroll.approve'));
  const regular = counts.all - counts.joiners - counts.exits;

  const act = async (path: string, body: any, message: string) => {
    try { await payrollApi.post(path, body); toast.success(message); props.reload(); run.reload(); results.reload(); dash.reload(); }
    catch (e: any) {
      if (e.code === 'PAY_BLOCKING_VALIDATION') { toast.error(e); setExceptionsOpen(true); } else toast.error(e);
    }
  };

  return (
    <div>
      <StepHeader number={7} title="Review & Finalize Payroll" subtitle="Review employee-wise payroll details, resolve exceptions and submit for approval."
        actions={<>
          {!locked && can('payroll.process') && ['ready', 'validation_failed', 'returned', 'rejected', 'calculated'].includes(r.status) && (
            <Button loading={calculating} onClick={calculate}><Icons.refresh className="h-4 w-4" /> Recalculate</Button>
          )}
          <Button onClick={() => downloadCsvRows(`payroll_${period.year}_${period.month}_run${r.run_no}.csv`,
            ['Employee', 'Emp ID', 'Department', 'Gross', 'Deductions', 'Net', 'Variance %', 'Status'],
            rows.map((x) => [x.employee.name, x.employee.employee_code, x.employee.department, x.gross_earnings, x.total_deductions, x.net_pay, x.variance_pct, x.validation_status]))}>
            Export <Icons.download className="h-4 w-4" />
          </Button>
        </>} />
      <LockedNotice locked={props.periodLocked} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <Badge status={r.status} label={`Run #${r.run_no} · ${r.status_label}`} />
        <span>Calculated {fmtDateTime(r.calculated_at)} by {r.created_by?.name ?? '—'}</span>
        <span className="font-mono text-xs">inputs {r.input_snapshot_id.slice(0, 10)} · config {r.configuration_snapshot_id.slice(0, 10)} · engine {r.engine_version}</span>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total Employees" value={r.employee_count} sub={`${regular} regular | ${counts.all - regular} others`} icon={Icons.users} tone="blue" />
        <StatCard label="Gross Payroll" value={inr(r.gross_total)} trend={kpi('gross')?.change_pct} sub={kpi('gross')?.change_pct ? 'vs last month' : undefined} icon={Icons.money} tone="green" />
        <StatCard label="Total Deductions" value={inr(r.deduction_total)} trend={kpi('deductions')?.change_pct} icon={Icons.pie} tone="blue" />
        <StatCard label="Net Pay" value={inr(r.net_total)} trend={kpi('net')?.change_pct} icon={Icons.hand} tone="green" />
        <StatCard label="Payroll Cost (CTC)" value={inr(r.employer_cost_total)} trend={kpi('employer_cost')?.change_pct} icon={Icons.bank} tone="purple" />
      </div>
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <button onClick={() => setExceptionsOpen(true)} className="flex items-center gap-3 rounded-lg bg-rose-50 px-4 py-3 text-left text-rose-800">
          <Icons.error className="h-7 w-7" /><span><span className="block font-semibold">{r.error_count} Errors</span><span className="text-sm">Must be resolved</span></span>
        </button>
        <button onClick={() => setExceptionsOpen(true)} className="flex items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-left text-amber-800">
          <Icons.alert className="h-7 w-7" /><span><span className="block font-semibold">{r.warning_count} Warnings</span><span className="text-sm">Review & acknowledge</span></span>
        </button>
        <button onClick={() => setExceptionsOpen(true)} className="flex items-center justify-between gap-3 rounded-lg bg-blue-50 px-4 py-3 text-left text-blue-800">
          <span className="flex items-center gap-3"><Icons.info className="h-7 w-7" /><span><span className="block font-semibold">{r.info_count} Information</span><span className="text-sm">New joiners, exits, revisions</span></span></span>
          <span className="text-sm font-medium">View All Exceptions →</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[1fr_440px]">
        <Card padded={false}>
          <div className="px-4 pt-3">
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: 'all', label: 'All Employees', count: counts.all },
              { key: 'exceptions', label: 'Exceptions', count: counts.exceptions, tone: 'red' },
              { key: 'joiners', label: 'New Joiners', count: counts.joiners, tone: 'red' },
              { key: 'exits', label: 'Exits', count: counts.exits, tone: 'red' },
              { key: 'revisions', label: 'Salary Revisions', count: counts.revisions, tone: 'red' },
              { key: 'reimbursements', label: 'Reimbursements', count: counts.reimbursements, tone: 'red' },
              { key: 'holds', label: 'Holds/Adjustments', count: counts.holds, tone: 'red' },
            ]} />
          </div>
          <div className="flex flex-wrap gap-3 px-4 pb-3">
            <div className="w-72"><SearchBox value={search} onChange={setSearch} placeholder="Search by name, emp ID, department..." /></div>
            <div className="w-44"><Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Department" options={(results.data?.meta?.departments ?? []).map((d: string) => ({ value: d, label: d }))} /></div>
            <div className="w-40"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Status" options={['ready', 'warning', 'error', 'on_hold'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} /></div>
          </div>
          {results.loading && !results.data ? <Spinner /> : (
            <Table>
              <thead><tr><Th>Employee</Th><Th>Emp ID</Th><Th>Department</Th><Th align="right">Gross Pay (₹)</Th><Th align="right">Deductions (₹)</Th><Th align="right">Net Pay (₹)</Th><Th align="right">Variance</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((x) => {
                  const v = x.variance_pct === null ? null : Number(x.variance_pct);
                  return (
                    <tr key={x.id} className={cx('cursor-pointer hover:bg-slate-50', selected === x.id && 'bg-blue-50/60')} onClick={() => setSelected(x.id)}>
                      <Td><EmployeeCell employee={x.employee} /></Td><Td>{x.employee.employee_code}</Td><Td>{x.employee.department}</Td>
                      <Td align="right">{Number(x.gross_earnings).toLocaleString('en-IN')}</Td>
                      <Td align="right">{Number(x.total_deductions).toLocaleString('en-IN')}</Td>
                      <Td align="right" className="font-semibold">{Number(x.net_pay).toLocaleString('en-IN')}</Td>
                      <Td align="right" className={v === null ? 'text-slate-400' : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-rose-600' : ''}>{v === null ? 'New' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}</Td>
                      <Td><Badge status={x.validation_status} label={x.validation_status === 'on_hold' ? 'On Hold' : undefined} /></Td>
                    </tr>
                  );
                })}
                {paged.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-slate-500">No employees in this view.</Td></tr>}
              </tbody>
            </Table>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            <span>Showing {rows.length ? (page - 1) * PAGE + 1 : 0} – {Math.min(page * PAGE, rows.length)} of {rows.length} employees</span>
            <span className="flex gap-1">
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setPage(p)} className={cx('h-8 w-8 rounded-md', p === page ? 'bg-blue-900 text-white' : 'hover:bg-slate-100')}>{p}</button>
              ))}
            </span>
          </div>
        </Card>
        <ResultPanel resultId={selected} onClose={() => setSelected(null)} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <Button onClick={() => props.go('statutory')}><Icons.arrowLeft className="h-4 w-4" /> Back</Button>
        <div className="flex flex-wrap gap-3">
          <Link href={`/payroll/reports?period=${periodId}&report=register`} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700">View Pay Register</Link>
          {can('payroll.process') && r.status === 'ready' && !locked && (
            <Button className="px-5 py-2.5" onClick={() => act(`runs/${runId}/submit`, {}, 'Submitted for approval')}>Submit for Approval</Button>
          )}
          {canDecide && (<>
            <Button onClick={() => setDecision('return')}>Return</Button>
            <Button variant="danger" onClick={() => setDecision('reject')}>Reject</Button>
            <Button variant="success" onClick={() => act(`runs/${runId}/approvals`, { decision: 'approve' }, `${pendingStage.stage_label} approved`)}>Approve ({pendingStage.stage_label})</Button>
          </>)}
          {(r.status === 'approved' || r.status === 'finalized') && (
            <Button variant="primary" className="px-6 py-2.5" onClick={() => props.go(r.status === 'finalized' ? 'completed' : 'finalize')}>
              {r.status === 'finalized' ? 'Post-payroll actions' : 'Finalize Payroll'} <Icons.arrowRight className="h-4 w-4" />
            </Button>
          )}
          {r.status === 'submitted' && !canDecide && <span className="self-center text-sm text-slate-500">Awaiting {pendingStage?.stage_label}</span>}
        </div>
      </div>
      {r.approvals.length > 0 && (
        <Card title="Approval trail" className="mt-4">
          <ol className="flex flex-wrap gap-6 text-sm">
            {r.approvals.map((a: any) => (
              <li key={a.id}><Badge status={a.status} label={`${a.stage === 'prepared' ? 'Prepared' : a.stage_label}: ${a.status}`} />
                <div className="mt-1 text-xs text-slate-500">{a.approver?.name ?? ''} {a.acted_at ? fmtDateTime(a.acted_at) : ''}</div>
                {a.comments && a.stage !== 'prepared' && <div className="text-xs italic text-slate-500">“{a.comments}”</div>}</li>
            ))}
          </ol>
        </Card>
      )}
      <ExceptionsModal open={exceptionsOpen} runId={runId} canAck={can('payroll.process') && !locked && ['ready', 'validation_failed', 'returned', 'rejected'].includes(r.status)}
        onClose={() => { setExceptionsOpen(false); run.reload(); }} />
      <ReasonDialog open={decision !== null} title={decision === 'reject' ? 'Reject payroll' : 'Return payroll for changes'} requireReason="Comments"
        variant={decision === 'reject' ? 'danger' : 'primary'} confirmLabel={decision === 'reject' ? 'Reject' : 'Return'}
        onClose={() => setDecision(null)} onConfirm={async (c) => { await act(`runs/${runId}/approvals`, { decision, comments: c }, decision === 'reject' ? 'Payroll rejected' : 'Payroll returned'); setDecision(null); }} />
    </div>
  );
}

function ResultPanel({ resultId, onClose }: { resultId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<'pay' | 'attendance' | 'trace' | 'issues'>('pay');
  const { data, loading } = useLoad(() => (resultId ? payrollApi.get<any>(`results/${resultId}`).then((r) => r.data) : Promise.resolve(null)), [resultId]);
  if (!resultId) return <Card><div className="py-16 text-center text-sm text-slate-500">Select an employee to see the calculation detail.</div></Card>;
  if (loading || !data) return <Card><Spinner /></Card>;
  const e = data.employee;
  const earnings = data.lines.filter((l: any) => l.component_type === 'earning');
  const deductions = data.lines.filter((l: any) => l.component_type === 'deduction');
  const employer = data.lines.filter((l: any) => l.component_type === 'employer_contribution');
  const v = data.variance_pct === null ? null : Number(data.variance_pct);
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3"><Avatar name={e.name} />
          <div><div className="flex items-center gap-2 text-lg font-semibold">{e.name}<Badge status={data.validation_status} /></div>
            <div className="text-sm text-slate-500">{e.employee_code} | {e.department} | {e.employment_type?.replace('_', '-')}</div></div></div>
        <button onClick={onClose} className="text-slate-400"><Icons.x className="h-5 w-5" /></button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'pay', label: 'Earnings & Deductions' }, { key: 'attendance', label: 'Attendance & Leave' },
        { key: 'trace', label: 'Calculation Trace' }, { key: 'issues', label: 'Exceptions', count: data.exceptions.length, tone: 'red' }]} />
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Gross Pay</div><div className="text-xl font-bold">{inr(data.gross_earnings)}</div></div>
        <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Deductions</div><div className="text-xl font-bold">{inr(data.total_deductions)}</div></div>
        <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Net Pay</div><div className="text-xl font-bold text-emerald-800">{inr(data.net_pay)}</div></div>
      </div>
      {tab === 'pay' && (
        <div className="space-y-3">
          <LineBlock title="Earnings" tone="green" lines={earnings} total={data.gross_earnings} totalLabel="Total Earnings (Gross)" />
          <LineBlock title="Deductions" tone="red" lines={deductions} total={data.total_deductions} totalLabel="Total Deductions" />
          {employer.length > 0 && <LineBlock title="Employer Contributions" tone="purple" lines={employer} total={data.employer_contributions} totalLabel="Total Employer" />}
          {v !== null && Math.abs(v) > 0 && (
            <Alert tone="amber">Net pay {v > 0 ? 'increased' : 'decreased'} by {Math.abs(v).toFixed(1)}% compared to the previous payroll ({inr(data.previous_net_pay)}).</Alert>
          )}
        </div>
      )}
      {tab === 'attendance' && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[['Working days (denominator)', num(data.working_days)], ['Payable days', num(data.payable_days)], ['LOP days', num(data.lop_days)],
            ['Present days', data.attendance ? num(data.attendance.present_days) : '—'], ['Paid leave', data.attendance ? num(data.attendance.paid_leave_days) : '—'],
            ['Unpaid leave', data.attendance ? num(data.attendance.unpaid_leave_days) : '—'], ['OT hours', data.attendance ? num(data.attendance.ot_hours) : '—'],
            ['Attendance source', data.attendance ? `${data.attendance.source} (${data.attendance.status})` : 'Missing — full days assumed']].map(([k, val]) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold text-slate-900">{val}</dd></div>
          ))}
          <div className="col-span-2 text-xs text-slate-500">
            {data.segments.map((s: any, i: number) => <div key={i}>Segment {s.from} → {s.to}: {s.structure}, CTC {inr(s.annual_ctc)}, compensation v{s.compensation_version}, PD {s.payable_days}, LOP {s.lop_days}</div>)}
          </div>
        </dl>
      )}
      {tab === 'trace' && (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-slate-500">Run #{data.run.run_no} · engine {data.run.engine_version} · input snapshot {data.run.input_snapshot_id.slice(0, 12)} · config {data.run.configuration_snapshot_id.slice(0, 12)}</div>
          {data.lines.map((l: any) => (
            <details key={l.id} className="rounded-lg border border-slate-200 p-3">
              <summary className="flex cursor-pointer items-center justify-between font-medium">
                <span>{l.component_name} <span className="text-xs text-slate-400">{l.component_code}</span>{l.is_overridden && <span className="ml-2"><Badge tone="amber" label="Overridden" /></span>}</span>
                <span>{inr(l.amount, { decimals: true })}</span>
              </summary>
              <dl className="mt-2 grid grid-cols-[110px_1fr] gap-1 text-xs">
                <dt className="text-slate-500">Basis</dt><dd>{l.calculation_basis}</dd>
                <dt className="text-slate-500">Formula</dt><dd className="font-mono">{l.formula || '—'}</dd>
                <dt className="text-slate-500">Pre-round</dt><dd>{l.pre_round_amount}</dd>
                <dt className="text-slate-500">Calculated</dt><dd>{l.calculated_amount}</dd>
                <dt className="text-slate-500">Rule version</dt><dd>{l.rule_version}</dd>
                <dt className="text-slate-500">Sources</dt><dd>{l.source_refs.join('; ') || '—'}</dd>
                {l.dependencies.length > 0 && (<><dt className="text-slate-500">Notes</dt><dd>{l.dependencies.join('; ')}</dd></>)}
                {Object.keys(l.inputs || {}).length > 0 && (<><dt className="text-slate-500">Inputs</dt><dd className="break-all font-mono">{JSON.stringify(l.inputs)}</dd></>)}
              </dl>
            </details>
          ))}
        </div>
      )}
      {tab === 'issues' && (
        <ul className="space-y-2 text-sm">
          {data.exceptions.map((x: any) => (
            <li key={x.id} className="flex gap-2 rounded-lg border border-slate-200 p-3">
              <Badge status={x.severity} /><span className="flex-1">{x.message}<span className="block text-xs text-slate-400">{x.rule_code} · {x.status}</span></span>
            </li>
          ))}
          {!data.exceptions.length && <li className="text-slate-500">No exceptions.</li>}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <Link href={`/payroll/compensation/${e.id}`} className="text-sm font-medium text-blue-700">Open employee compensation →</Link>
      </div>
    </Card>
  );
}

function LineBlock({ title, tone, lines, total, totalLabel }: { title: string; tone: 'green' | 'red' | 'purple'; lines: any[]; total: string; totalLabel: string }) {
  const head = { green: 'bg-emerald-50 text-emerald-800', red: 'bg-rose-50 text-rose-800', purple: 'bg-violet-50 text-violet-800' }[tone];
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className={cx('px-3 py-2 text-sm font-semibold', head)}>{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-slate-100"><td className="px-3 py-1.5">{l.component_name}{l.is_overridden && ' *'}</td><td className="px-3 py-1.5 text-right tabular-nums">{Number(l.amount).toLocaleString('en-IN')}</td></tr>
          ))}
          <tr className={cx('border-t border-slate-200 font-semibold', head)}><td className="px-3 py-2">{totalLabel}</td><td className="px-3 py-2 text-right">{Number(total).toLocaleString('en-IN')}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ExceptionsModal({ open, runId, canAck, onClose }: { open: boolean; runId: string; canAck: boolean; onClose: () => void }) {
  const { data, reload } = useLoad(() => (open ? payrollApi.get<any[]>(`runs/${runId}/exceptions`).then((r) => r.data) : Promise.resolve([])), [open, runId]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bulkNote, setBulkNote] = useState('');
  const warnings = (data ?? []).filter((x) => x.severity === 'warning' && x.status === 'open');
  const ack = async (id: string, note: string) => {
    try { await payrollApi.post(`exceptions/${id}/acknowledge`, { note }); } catch (e) { toast.error(e); throw e; }
  };
  return (
    <Modal open={open} onClose={onClose} title="Payroll exceptions" size="max-w-4xl"
      footer={canAck && warnings.length > 0 ? (
        <div className="flex w-full items-center gap-2">
          <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder="Note for acknowledging all open warnings"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <Button variant="primary" disabled={!bulkNote.trim()} onClick={async () => {
            for (const w of warnings) await ack(w.id, bulkNote);
            toast.success(`${warnings.length} warning(s) acknowledged`); reload();
          }}>Acknowledge all ({warnings.length})</Button>
        </div>
      ) : undefined}>
      <p className="mb-3 text-sm text-slate-600">Blocking errors stop submission and finalization until fixed and recalculated. Warnings need a reviewed note before submitting. Information items are for context.</p>
      <Table>
        <thead><tr><Th>Severity</Th><Th>Employee</Th><Th>Rule</Th><Th>Message</Th><Th>Status</Th><Th /></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {(data ?? []).map((x) => (
            <tr key={x.id}>
              <Td><Badge status={x.severity} /></Td><Td>{x.employee ? `${x.employee.name} (${x.employee.employee_code})` : 'Run'}</Td>
              <Td className="font-mono text-xs">{x.rule_code}</Td><Td className="max-w-md whitespace-normal">{x.message}{x.resolution_note && <div className="text-xs text-slate-500">Note: {x.resolution_note} — {x.acknowledged_by?.name}</div>}</Td>
              <Td><Badge status={x.status} /></Td>
              <Td>{canAck && x.severity === 'warning' && x.status === 'open' && (
                <span className="flex gap-1">
                  <input value={notes[x.id] ?? ''} onChange={(e) => setNotes({ ...notes, [x.id]: e.target.value })} placeholder="Note" className="w-32 rounded border border-slate-300 px-2 py-1 text-xs" />
                  <Button size="sm" disabled={!notes[x.id]?.trim()} onClick={async () => { await ack(x.id, notes[x.id]); reload(); }}>Ack</Button>
                </span>
              )}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Modal>
  );
}
