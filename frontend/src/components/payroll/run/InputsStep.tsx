'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Avatar, Badge, Button, Card, Drawer, EmployeeCell, ErrorBanner, Field, Icons, Input, Modal, ReasonDialog, SearchBox, Select,
  Spinner, StatCard, Table, Tabs, Td, Textarea, Th, cx, downloadCsvRows, fmtDate, fmtDateTime, inr, inrShort, num, toast, useLoad,
} from '../ui';
import { PayrollApiError, idempotencyKey, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';
import { LockedNotice, StepFooter, StepHeader, type StepProps } from './common';

const VARIANTS = {
  variable: {
    number: 3, step: 'revisions_variable', back: 'joiners_exits', title: 'Salary Revisions, Bonus & Overtime',
    subtitle: 'Manage salary changes, incentives, bonus, overtime and other variable pay for this payroll.',
    tabs: [
      { key: 'revisions', label: 'Salary Revisions', types: [] as string[] },
      { key: 'bonus', label: 'Bonus & Incentives', types: ['bonus', 'incentive'] },
      { key: 'ot', label: 'Overtime & Shift Allowances', types: ['overtime', 'shift_allowance'] },
      { key: 'arrears', label: 'Arrears & One-time Payments', types: ['arrears', 'one_time_earning'] },
    ],
  },
  reimbursements: {
    number: 4, step: 'reimbursements', back: 'revisions_variable', title: 'Reimbursements & Deductions',
    subtitle: 'Add and review reimbursements, ad-hoc payments and deductions for this payroll.',
    tabs: [
      { key: 'reimbursements', label: 'Reimbursements', types: ['reimbursement'] },
      { key: 'adhoc_earnings', label: 'Ad-hoc Earnings', types: ['one_time_earning'] },
      { key: 'adhoc_deductions', label: 'Ad-hoc Deductions', types: ['adhoc_deduction', 'recovery'] },
      { key: 'loans', label: 'Loan / Advances', types: ['loan_recovery'] },
    ],
  },
};

export function InputsStep(props: StepProps & { variant: 'variable' | 'reimbursements' }) {
  const v = VARIANTS[props.variant];
  const { periodId, period, locked } = props;
  const { meta, can } = usePayrollMeta();
  const allTypes = v.tabs.flatMap((t) => t.types);
  const inputs = useLoad(() => payrollApi.get<any[]>(`periods/${periodId}/inputs?type=${allTypes.join(',')}`), [periodId, props.variant]);
  const revisions = useLoad(() => (props.variant === 'variable'
    ? payrollApi.get<any[]>('compensations').then((r) => r.data.filter((x: any) => x.effective_from >= period.start_date.slice(0, 8) + '01' && x.effective_from <= period.end_date && x.status !== 'cancelled'))
    : Promise.resolve([])), [periodId, props.variant]);
  const [tab, setTab] = useState(v.tabs[0].key);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rejecting, setRejecting] = useState<any | null>(null);

  if (inputs.loading && !inputs.data) return <Spinner />;
  const rows = inputs.data?.data ?? [];
  const currentTab = v.tabs.find((t) => t.key === tab)!;
  const filtered = rows.filter((r) => currentTab.types.includes(r.input_type) && (!status || r.status === status)
    && (!search || `${r.employee.name} ${r.employee.employee_code} ${r.employee.department}`.toLowerCase().includes(search.toLowerCase())));
  const sum = (types: string[], st?: string[]) => rows.filter((r) => types.includes(r.input_type) && (!st || st.includes(r.status)))
    .reduce((a, r) => a + Number(r.amount ?? 0), 0);
  const count = (types: string[]) => rows.filter((r) => types.includes(r.input_type) && !['rejected', 'superseded'].includes(r.status)).length;
  const pending = rows.filter((r) => r.status === 'pending').length;

  const decide = async (r: any, decision: string, comment = '') => {
    try {
      await payrollApi.post(`periods/${periodId}/inputs/${r.id}/decide`, { decision, comment });
      toast.success(decision === 'approve' ? 'Approved' : 'Rejected'); setRejecting(null); setSelected(null); inputs.reload();
    } catch (e) { toast.error(e); }
  };

  const kpis = props.variant === 'variable' ? [
    <StatCard key="rev" label="Employees with Salary Revision" value={revisions.data?.length ?? 0} icon={Icons.trend} tone="green" />,
    <StatCard key="bonus" label="Bonus / Incentives" value={count(['bonus', 'incentive'])} sub={`Total ${inr(sum(['bonus', 'incentive'], ['approved', 'included', 'pending']))}`} icon={Icons.gift} tone="green" />,
    <StatCard key="ot" label="Overtime Entries" value={count(['overtime', 'shift_allowance'])} sub={`Total ${num(rows.filter((r) => r.input_type === 'overtime').reduce((a, r) => a + Number(r.units ?? 0), 0))} hours`} icon={Icons.clock} tone="blue" />,
    <StatCard key="arr" label="Arrears / One-time Payments" value={count(['arrears', 'one_time_earning'])} sub={`Total ${inr(sum(['arrears', 'one_time_earning']))}`} icon={Icons.file} tone="blue" />,
    <StatCard key="pend" label="Pending Items" value={<span className="text-rose-600">{pending}</span>} sub="Require review" icon={Icons.alert} tone="amber" />,
  ] : [
    <StatCard key="r" label="Total Reimbursements" value={inrShort(sum(['reimbursement'], ['approved', 'included']))} icon={Icons.wallet} tone="green" />,
    <StatCard key="e" label="Ad-hoc Earnings" value={inrShort(sum(['one_time_earning'], ['approved', 'included']))} icon={Icons.money} tone="blue" />,
    <StatCard key="d" label="Ad-hoc Deductions" value={inrShort(sum(['adhoc_deduction', 'recovery', 'loan_recovery'], ['approved', 'included']))} icon={Icons.report} tone="red" />,
    <StatCard key="p" label="Pending Approvals" value={<span className="text-rose-600">{pending}</span>}
      sub={`${rows.filter((r) => r.status === 'pending' && r.input_type === 'reimbursement').length} reimbursements | ${rows.filter((r) => r.status === 'pending' && r.input_type !== 'reimbursement').length} other`} icon={Icons.hourglass} tone="amber" />,
  ];

  return (
    <div>
      <StepHeader number={v.number} title={v.title} subtitle={v.subtitle}
        actions={!locked && (<>
          <Button onClick={() => setImporting(true)}><Icons.upload className="h-4 w-4" /> Bulk Update</Button>
          {props.variant === 'reimbursements' && (
            <Button onClick={async () => {
              try { const r = await payrollApi.post<any>(`periods/${periodId}/inputs/generate-loans`, {}); toast.success(`${r.data.created} loan instalment(s) posted`); inputs.reload(); }
              catch (e) { toast.error(e); }
            }}>Post loan instalments</Button>
          )}
        </>)} />
      <LockedNotice locked={props.periodLocked} />
      <ErrorBanner error={inputs.error} />
      <div className={cx('mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2', props.variant === 'variable' ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>{kpis}</div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <Card padded={false}>
          <div className="px-4 pt-3">
            <Tabs value={tab} onChange={(k) => { setTab(k); setSelected(null); }} tabs={v.tabs.map((t) => ({
              key: t.key, label: t.label, tone: 'red' as const,
              count: t.key === 'revisions' ? revisions.data?.length ?? 0 : count(t.types),
            }))} />
          </div>
          {tab === 'revisions' ? <RevisionsTable rows={revisions.data ?? []} /> : (
            <>
              <div className="flex flex-wrap gap-3 px-4 pb-3">
                <div className="w-72"><SearchBox value={search} onChange={setSearch} placeholder="Search by name, emp ID, department..." /></div>
                <div className="w-40"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Status"
                  options={['pending', 'approved', 'rejected', 'included'].map((s) => ({ value: s, label: s }))} /></div>
                <Button onClick={() => downloadCsvRows(`${tab}.csv`, ['Employee', 'Emp ID', 'Type', 'Component', 'Amount', 'Units', 'Reason', 'Status'],
                  filtered.map((r) => [r.employee.name, r.employee.employee_code, r.type_label, r.component_name, r.amount, r.units, r.reason, r.status]))}>
                  <Icons.download className="h-4 w-4" /> Download</Button>
                {!locked && <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}><Icons.plus className="h-4 w-4" /> Add {currentTab.label.replace(/s$/, '')}</Button>}
              </div>
              <Table>
                <thead><tr><Th>Employee</Th><Th>Emp ID</Th><Th>Department</Th><Th>Request Type</Th><Th align="right">Amount (₹)</Th><Th align="right">Units</Th><Th>Reason</Th><Th>Status</Th><Th>Approved By</Th><Th>Action</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((r) => (
                    <tr key={r.id} className={cx('hover:bg-slate-50', selected?.id === r.id && 'bg-blue-50/60')}>
                      <Td><EmployeeCell employee={r.employee} onClick={() => setSelected(r)} /></Td>
                      <Td>{r.employee.employee_code}</Td><Td>{r.employee.department}</Td>
                      <Td>{r.component_name}<div className="text-xs text-slate-400">{r.type_label}</div></Td>
                      <Td align="right">{r.amount ? Number(r.amount).toLocaleString('en-IN') : '—'}</Td>
                      <Td align="right">{r.units ? num(r.units) : '—'}</Td>
                      <Td className="max-w-[200px] truncate">{r.reason}</Td>
                      <Td><Badge status={r.status} label={r.status_label} /></Td>
                      <Td>{r.approved_by?.name ?? '-'}</Td>
                      <Td><button className="text-sm font-medium text-blue-700" onClick={() => setSelected(r)}>View</button></Td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><Td colSpan={10} className="py-8 text-center text-slate-500">No items. {!locked && 'Use Add to enter one.'}</Td></tr>}
                </tbody>
              </Table>
              <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">Showing {filtered.length} of {count(currentTab.types)} items</div>
            </>
          )}
        </Card>
        <InputPanel input={selected} locked={props.periodLocked} canApprove={can('payroll.process') || can('payroll.review') || can('payroll.approve')}
          meId={meta?.employee_id} onClose={() => setSelected(null)}
          onApprove={(r) => decide(r, 'approve')} onReject={(r) => setRejecting(r)} />
      </div>
      <StepFooter props={props} step={v.step} back={v.back} />
      <AddInput open={adding} periodId={periodId} types={currentTab.types} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); inputs.reload(); }} />
      <ImportInputs open={importing} periodId={periodId} onClose={() => setImporting(false)} onDone={() => { setImporting(false); inputs.reload(); }} />
      <ReasonDialog open={!!rejecting} title="Reject input" requireReason="Comment" variant="danger" confirmLabel="Reject"
        onClose={() => setRejecting(null)} onConfirm={(c) => decide(rejecting, 'reject', c)} />
    </div>
  );
}

function RevisionsTable({ rows }: { rows: any[] }) {
  return (
    <div>
      <Table>
        <thead><tr><Th>Employee</Th><Th>Emp ID</Th><Th>Department</Th><Th align="right">Current Monthly Salary</Th><Th align="right">Revised Monthly Salary</Th><Th>Effective Date</Th><Th>Reason</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><EmployeeCell employee={r.employee} href={`/payroll/compensation/${r.employee.id}`} /></Td>
              <Td>{r.employee.employee_code}</Td><Td>{r.employee.department}</Td>
              <Td align="right">{inr(r.current_compensation?.breakup?.totals?.gross_monthly)}</Td>
              <Td align="right">{inr(r.breakup?.totals?.gross_monthly)}</Td>
              <Td>{fmtDate(r.effective_from)}</Td><Td>{r.type_label}</Td>
              <Td><Badge status={r.status === 'approved' ? 'active' : r.status} label={r.status === 'approved' ? 'Applied' : r.status_label} /></Td>
              <Td><Link className="text-sm font-medium text-blue-700" href={`/payroll/compensation/${r.employee.id}`}>View</Link></Td>
            </tr>
          ))}
          {rows.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-slate-500">No salary revisions take effect in this period.</Td></tr>}
        </tbody>
      </Table>
      <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
        Revisions are raised and approved under Employee Compensation; approved revisions effective in this period are applied automatically (split-period if the pay group allows).
      </div>
    </div>
  );
}

function InputPanel({ input: r, locked, canApprove, meId, onClose, onApprove, onReject }: {
  input: any; locked: boolean; canApprove: boolean; meId: number | null | undefined; onClose: () => void; onApprove: (r: any) => void; onReject: (r: any) => void;
}) {
  if (!r) return <Card><div className="py-16 text-center text-sm text-slate-500">Select an item to see details, source and approval.</div></Card>;
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3"><Avatar name={r.employee.name} />
          <div><div className="flex items-center gap-2 font-semibold">{r.employee.name}<Badge status={r.status} label={r.status_label} /></div>
            <div className="text-sm text-slate-500">{r.employee.employee_code} | {r.employee.department}</div></div></div>
        <button onClick={onClose} className="text-slate-400"><Icons.x className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Request Type"><Input value={r.component_name} disabled /></Field>
        <Field label="Amount"><Input value={r.amount ? inr(r.amount, { decimals: true }) : `${num(r.units)} units`} disabled /></Field>
        <Field label="Entered"><Input value={fmtDateTime(r.created_at)} disabled /></Field>
        <Field label="Source"><Input value={`${r.source_module}${r.source_row_key ? ` · ${r.source_row_key}` : ''}`} disabled /></Field>
      </div>
      <Field label="Purpose" className="mt-3"><Textarea value={r.reason} disabled /></Field>
      {r.decision_comment && <Field label="Comments" className="mt-3"><Textarea value={r.decision_comment} disabled /></Field>}
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
        <Icons.clock className="h-5 w-5" />
        <div><div className="font-semibold">Approval Workflow</div>
          {r.status === 'pending' ? `Entered by ${r.created_by?.name}; awaiting approval (maker-checker).`
            : `${r.status_label} by ${r.approved_by?.name ?? '—'} ${r.approved_at ? `on ${fmtDateTime(r.approved_at)}` : ''}`}</div>
      </div>
      {!locked && canApprove && ['pending', 'rejected'].includes(r.status) && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button onClick={() => onReject(r)}>Reject</Button>
          <Button variant="primary" onClick={() => onApprove(r)}>Approve</Button>
        </div>
      )}
      {r.created_by && meId !== undefined && r.status === 'pending' && <p className="mt-2 text-xs text-slate-400">The person who entered an item cannot approve it.</p>}
    </Card>
  );
}

function AddInput({ open, periodId, types, onClose, onSaved }: { open: boolean; periodId: string; types: string[]; onClose: () => void; onSaved: () => void }) {
  const { meta } = usePayrollMeta();
  const population = useLoad(() => (open ? payrollApi.get<any[]>(`periods/${periodId}/population`).then((r) => r.data) : Promise.resolve([])), [open]);
  const components = useLoad(() => payrollApi.get<any[]>('components?status=active').then((r) => r.data), []);
  const [form, setForm] = useState<any>({ employee: '', input_type: types[0], component: '', amount: '', units: '', rate: '', reason: '', remarks: '', reference_period: '', expense_date: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The drawer is mounted once; reset the type to the current tab's first type
  // each time it opens so the select and the submitted value always agree.
  useEffect(() => {
    if (open) {
      setError(null);
      setForm((f: any) => (types.includes(f.input_type) ? f : { ...f, input_type: types[0], component: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, types.join(',')]);
  const isEarning =!['adhoc_deduction', 'recovery', 'loan_recovery', 'tds'].includes(form.input_type);
  const comps = (components.data ?? []).filter((c) => c.component_type === (isEarning ? 'earning' : 'deduction') && ['actual', 'units_rate', 'formula', 'fixed'].includes(c.calculation_type));
  const fields = (error instanceof PayrollApiError ? error.fields : {}) as Record<string, any>;
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <Drawer open={open} onClose={onClose} title="Add payroll input" subtitle="Every manual item records who entered it, when and why, and needs approval before it is paid."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const r = await payrollApi.post<any>(`periods/${periodId}/inputs`, {
            ...form, employee: Number(form.employee), amount: form.amount || null, units: form.units || null, rate: form.rate || null, expense_date: form.expense_date || null,
          });
          toast.success(r.data.possible_duplicates ? 'Saved — possible duplicate flagged for review' : 'Input added (pending approval)');
          setForm({ ...form, amount: '', units: '', reason: '' });
          onSaved();
        } catch (e) { setError(e); } finally { setBusy(false); }
      }}>Save</Button></>}>
      <div className="space-y-4">
        <ErrorBanner error={error} />
        <Field label="Employee" required error={fields.employee}>
          <Select value={form.employee} placeholder="Choose employee" onChange={(e) => set('employee', e.target.value)}
            options={(population.data ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.employee_code})` }))} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Type" required error={fields.input_type}><Select value={form.input_type} onChange={(e) => set('input_type', e.target.value)}
            options={(meta?.input_types ?? []).filter((o) => types.includes(o.value) || types.length === 0)} /></Field>
          <Field label="Component" required error={fields.component}><Select value={form.component} placeholder="Choose" onChange={(e) => set('component', e.target.value)} options={comps.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Amount (₹)" error={fields.amount}><Input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
          <Field label="Units / hours" hint="For units × rate components"><Input type="number" value={form.units} onChange={(e) => set('units', e.target.value)} /></Field>
          {form.input_type === 'arrears' && <Field label="Original period (YYYY-MM)"><Input value={form.reference_period} onChange={(e) => set('reference_period', e.target.value)} /></Field>}
          {form.input_type === 'reimbursement' && <Field label="Expense date"><Input type="date" value={form.expense_date} onChange={(e) => set('expense_date', e.target.value)} /></Field>}
        </div>
        <Field label="Reason / purpose" required error={fields.reason}><Textarea value={form.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

function ImportInputs({ open, periodId, onClose, onDone }: { open: boolean; periodId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('row_key,employee_code,input_type,component_code,amount,units,rate,reason\n');
  const [batch, setBatch] = useState(`batch-${new Date().toISOString().slice(0, 10)}`);
  const [result, setResult] = useState<any>(null);
  return (
    <Modal open={open} onClose={onClose} title="Bulk import inputs" size="max-w-2xl"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={async () => {
        try { const r = await payrollApi.post<any>(`periods/${periodId}/inputs/import`, { csv: text, batch_id: batch }, { 'Idempotency-Key': idempotencyKey() }); setResult(r.data); toast.success(`${r.data.imported} imported`); if (!r.data.errors.length) onDone(); }
        catch (e) { toast.error(e); }
      }}>Import</Button></>}>
      <Field label="Batch id" hint="Re-importing a row_key from the same batch is rejected as a duplicate."><Input value={batch} onChange={(e) => setBatch(e.target.value)} /></Field>
      <input type="file" accept=".csv" className="my-2 text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <Textarea rows={10} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      {result?.errors?.length > 0 && <ErrorBanner error={{ message: `${result.imported} imported, ${result.errors.length} rejected`, fieldMessages: result.errors.map((x: any) => `Row ${x.row}: ${x.error}`) }} />}
    </Modal>
  );
}
