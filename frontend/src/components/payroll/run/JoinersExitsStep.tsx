'use client';

import { useState } from 'react';
import {
  Avatar, Badge, Button, Card, EmployeeCell, ErrorBanner, Field, Icons, Input, Select, Spinner, StatCard, Table, Tabs, Td,
  Textarea, Th, cx, fmtDate, inr, num, toast, useLoad,
} from '../ui';
import { payrollApi } from '@/lib/payroll/api';
import { LockedNotice, StepFooter, StepHeader, type StepProps } from './common';

/** Step 2 — New Joiners & Exits (UI 11). Joiners/exits are detected from the
 *  Employee Directory (DOJ / LWD); here payroll decides Process or Hold. */
export function JoinersExitsStep(props: StepProps) {
  const { periodId, locked } = props;
  const { data, error, loading, reload } = useLoad(() => payrollApi.get<any>(`periods/${periodId}/joiners-exits`).then((r) => r.data), [periodId]);
  const [tab, setTab] = useState<'joiners' | 'exits' | 'prorated'>('joiners');
  const [selected, setSelected] = useState<{ row: any; kind: 'joiner' | 'exit' } | null>(null);
  if (loading && !data) return <Spinner />;
  const joiners = data?.joiners ?? [];
  const exits = data?.exits ?? [];
  const pending = [...joiners, ...exits].filter((r: any) => !r.decision || r.decision === 'review').length;

  const decide = async (row: any, kind: string, decision: string, reason = '') => {
    try {
      await payrollApi.post(`periods/${periodId}/employee-actions`, { employee: row.employee.id, kind, decision, reason });
      toast.success(`${row.employee.name}: ${decision.replace('_', ' ')}`); reload();
    } catch (e) { toast.error(e); }
  };

  const table = (rows: any[], kind: 'joiner' | 'exit') => (
    <Table>
      <thead><tr><Th>Employee</Th><Th>Emp ID</Th><Th>{kind === 'joiner' ? 'DOJ' : 'LWD'}</Th><Th>Department</Th><Th>Employment Type</Th>
        <Th align="right">Payable Days</Th><Th align="right">{kind === 'joiner' ? 'Salary (Monthly)' : 'Net for period'}</Th><Th>Status</Th><Th>Action</Th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.employee.id} className={cx('hover:bg-slate-50', selected?.row.employee.id === r.employee.id && 'bg-blue-50/60')}>
            <Td><EmployeeCell employee={r.employee} onClick={() => setSelected({ row: r, kind })} /></Td>
            <Td>{r.employee.employee_code}</Td><Td>{fmtDate(r.date)}</Td><Td>{r.employee.department}</Td>
            <Td className="capitalize">{r.employee.employment_type?.replace('_', '-')}</Td>
            <Td align="right">{r.payable_days ? `${num(r.payable_days)} / ${num(r.working_days)}` : '—'}</Td>
            <Td align="right">{kind === 'joiner' ? inr(r.monthly_gross) : inr(r.net_pay)}</Td>
            <Td><Badge status={r.decision === 'process' ? 'ready' : r.decision ?? 'review'} label={r.decision === 'process' ? 'Ready' : r.decision === 'hold' ? 'Hold' : r.decision === 'ff_pending' ? 'F&F Pending' : 'Review'} /></Td>
            <Td>
              <select disabled={locked} value={r.decision ?? ''} onChange={(e) => decide(r, kind, e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="" disabled>Choose…</option>
                <option value="process">Process</option>
                <option value="hold">Hold</option>
                {kind === 'exit' && <option value="ff_pending">Process F&F separately</option>}
              </select>
            </Td>
          </tr>
        ))}
        {rows.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-slate-500">None in this period.</Td></tr>}
      </tbody>
    </Table>
  );

  return (
    <div>
      <StepHeader number={2} title="New Joiners & Exits" subtitle="Review new joiners, exits and final settlements for this payroll. Eligible components are prorated by the pay group's rule." />
      <LockedNotice locked={props.periodLocked} />
      <ErrorBanner error={error} />
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="New Joiners" value={joiners.length} sub="To be processed" icon={Icons.userPlus} tone="blue" />
        <StatCard label="Exits" value={exits.length} sub="Final settlement" icon={Icons.userMinus} tone="red" />
        <StatCard label="Prorated Employees" value={data?.prorated ?? 0} sub="Including mid-month joiners/exits" icon={Icons.calendar} tone="green" />
        <StatCard label="Pending Actions" value={<span className="text-rose-600">{pending}</span>} sub="Require review" icon={Icons.alert} tone="amber" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card padded={false}>
            <div className="px-4 pt-3">
              <Tabs value={tab} onChange={setTab} tabs={[{ key: 'joiners', label: 'New Joiners', count: joiners.length },
                { key: 'exits', label: 'Exits', count: exits.length, tone: 'red' }, { key: 'prorated', label: 'Prorated Employees', count: data?.prorated ?? 0, tone: 'red' }]} />
            </div>
            {tab === 'joiners' && table(joiners, 'joiner')}
            {tab === 'exits' && table(exits, 'exit')}
            {tab === 'prorated' && (
              <div className="p-5 text-sm text-slate-600">
                {data?.prorated ? `${data.prorated} employee(s) were prorated in the last calculation. Open Review & Finalize to see each calculation trace.` : 'Calculate payroll to see prorated employees.'}
              </div>
            )}
          </Card>
          {tab === 'joiners' && exits.length > 0 && (
            <Card title={`Exits (${exits.length})`} padded={false}>{table(exits, 'exit')}</Card>
          )}
        </div>
        <DetailPanel sel={selected} locked={locked} onClose={() => setSelected(null)} onSave={(d, reason) => selected && decide(selected.row, selected.kind, d, reason)} />
      </div>
      <StepFooter props={props} step="joiners_exits" back="attendance" />
    </div>
  );
}

function DetailPanel({ sel, locked, onClose, onSave }: { sel: any; locked: boolean; onClose: () => void; onSave: (decision: string, reason: string) => void }) {
  const [decision, setDecision] = useState('process');
  const [reason, setReason] = useState('');
  if (!sel) return <Card><div className="py-16 text-center text-sm text-slate-500">Select an employee to review proration and decide.</div></Card>;
  const { row, kind } = sel;
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3"><Avatar name={row.employee.name} />
          <div><div className="flex items-center gap-2 font-semibold">{row.employee.name}<Badge tone={kind === 'joiner' ? 'green' : 'red'} label={kind === 'joiner' ? 'New Joiner' : 'Exit'} /></div>
            <div className="text-sm text-slate-500">{row.employee.employee_code} | {row.employee.department}</div></div></div>
        <button onClick={onClose} className="text-slate-400"><Icons.x className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label={kind === 'joiner' ? 'Date of Joining' : 'Last Working Day'}><Input value={fmtDate(row.date)} disabled /></Field>
        <Field label="Payable Days"><Input value={row.payable_days ? `${num(row.payable_days)} / ${num(row.working_days)}` : 'Not calculated yet'} disabled /></Field>
        <Field label="Employment Type"><Input value={row.employee.employment_type} disabled /></Field>
        <Field label="Work Location"><Input value={row.employee.location} disabled /></Field>
        <Field label="Reporting Manager"><Input value={row.employee.manager || '—'} disabled /></Field>
        <Field label="Status">
          <Select value={decision} disabled={locked} onChange={(e) => setDecision(e.target.value)}
            options={[{ value: 'process', label: 'Process in Payroll' }, { value: 'hold', label: 'Hold' }, ...(kind === 'exit' ? [{ value: 'ff_pending', label: 'F&F pending (separate)' }] : [])]} />
        </Field>
      </div>
      <Field label="Reason" className="mt-3"><Textarea value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
        <div className="font-semibold">Proration Details</div>
        {row.payable_days ? `Salary will be prorated on ${num(row.payable_days)} payable days.` : 'Payable days are calculated when payroll is processed.'}
        {kind === 'exit' && <div className="mt-1 text-xs">Advanced full & final settlement is handled outside the MVP payroll run.</div>}
      </div>
      {!locked && <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(decision, reason)}>Save</Button></div>}
    </Card>
  );
}
