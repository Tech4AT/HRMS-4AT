'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Badge, Button, Card, ErrorBanner, Icons, Input, PageHeader, SearchBox, Select, Spinner, Table, Td, Th, cx, fmtDateTime, inr, monthLong,
  num, useLoad,
} from '@/components/payroll/ui';
import { downloadText, payrollApi, qs } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Standard Reports', keys: ['register', 'employee_summary', 'department_summary', 'earnings_deductions', 'variance', 'ytd'] },
  { title: 'Workforce & Inputs', keys: ['joiners', 'exits', 'revisions', 'lop', 'reimbursements'] },
  { title: 'Controls', keys: ['audit_trail'] },
];
const DESCRIPTIONS: Record<string, string> = {
  register: 'Complete employee payroll details', employee_summary: 'Gross, deductions and net per employee', department_summary: 'Department, location wise summary',
  earnings_deductions: 'Component wise breakdown', variance: 'Compare with previous month', ytd: 'Employee wise YTD earnings & deductions',
  joiners: 'Employees joined during the period', exits: 'Employees exited during the period', revisions: 'Salary revisions with change %',
  lop: 'Loss of pay days and impact', reimbursements: 'Reimbursement claims processed', audit_trail: 'Who changed what, when and why',
};

export default function ReportsPage() {
  const params = useSearchParams();
  const { can } = usePayrollMeta();
  const [tab, setTab] = useState<'reports' | 'audit'>(params.get('tab') === 'audit' ? 'audit' : 'reports');
  const periods = useLoad(() => payrollApi.get<any[]>('periods').then((r) => r.data), []);
  const catalog = useLoad(() => payrollApi.get<any[]>('reports').then((r) => r.data), []);
  const [period, setPeriod] = useState(params.get('period') ?? '');
  const [report, setReport] = useState(params.get('report') ?? 'register');
  useEffect(() => { if (!period && periods.data?.length) setPeriod(periods.data[0].id); }, [periods.data, period]);
  const data = useLoad(() => (period || report === 'audit_trail' ? payrollApi.get<any>(`reports/${report}${qs({ period })}`).then((r) => r.data) : Promise.resolve(null)), [period, report]);

  const exportCsv = async () => {
    const r = await payrollApi.get<any>(`reports/${report}${qs({ period, format: 'csv' })}`);
    downloadText(r.data.file_name, r.data.content);
  };
  const titles = Object.fromEntries((catalog.data ?? []).map((c) => [c.key, c.title]));

  return (
    <>
      <PayrollTopBar />
      <PageHeader crumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Reports' }]} title="Reports & Analytics" subtitle="Payroll register, summaries, variance, YTD and the audit trail. Exports are audited." />
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {([['reports', 'Standard Reports'], ['audit', 'Audit Trail']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600')}>{l}</button>
        ))}
      </div>
      {tab === 'audit' ? <AuditTrail /> : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
          <Card padded={false}>
            {GROUPS.map((g) => (
              <div key={g.title} className="border-b border-slate-100 p-3 last:border-0">
                <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</div>
                {g.keys.filter((k) => k !== 'audit_trail' || can('payroll.audit')).map((k) => (
                  <button key={k} onClick={() => setReport(k)} className={cx('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left', report === k ? 'bg-blue-50' : 'hover:bg-slate-50')}>
                    <span className="rounded-md bg-blue-50 p-1.5 text-blue-600"><Icons.report className="h-4 w-4" /></span>
                    <span className="flex-1"><span className="block text-sm font-medium text-slate-900">{titles[k] ?? k}</span><span className="block text-xs text-slate-500">{DESCRIPTIONS[k]}</span></span>
                    <Icons.chevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                ))}
              </div>
            ))}
          </Card>
          <Card title={data.data?.title ?? titles[report]} padded={false}
            actions={<div className="flex items-center gap-2">
              {report !== 'audit_trail' && <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-56"
                options={(periods.data ?? []).map((p) => ({ value: p.id, label: `${monthLong(p.year, p.month)} · ${p.pay_group_name}` }))} />}
              <Button onClick={exportCsv} disabled={!data.data}><Icons.download className="h-4 w-4" /> Export CSV</Button>
            </div>}>
            <ErrorBanner error={data.error} />
            {data.data && data.data.run_no && (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-slate-500">Run #{data.data.run_no}
                <Badge tone={data.data.is_official ? 'green' : 'amber'} label={data.data.is_official ? 'Official (finalized)' : `Draft (${data.data.run_status})`} /></div>
            )}
            {data.loading ? <Spinner /> : !data.data ? <div className="p-6 text-sm text-slate-500">Choose a period.</div> : (
              <div className="max-h-[70vh] overflow-auto">
                <Table>
                  <thead className="sticky top-0"><tr>{data.data.columns.map((c: any) => <Th key={c.key} align={c.type === 'money' || c.type === 'number' ? 'right' : 'left'}>{c.label}</Th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.rows.map((row: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {data.data.columns.map((c: any) => (
                          <Td key={c.key} align={c.type === 'money' || c.type === 'number' ? 'right' : 'left'}>
                            {c.type === 'money' ? (row[c.key] ? Number(row[c.key]).toLocaleString('en-IN') : '') : c.type === 'datetime' ? fmtDateTime(row[c.key]) : c.type === 'number' ? num(row[c.key]) : row[c.key]}
                          </Td>
                        ))}
                      </tr>
                    ))}
                    {data.data.rows.length === 0 && <tr><Td colSpan={data.data.columns.length} className="py-8 text-center text-slate-500">No data for this period (calculate payroll first).</Td></tr>}
                  </tbody>
                  {data.data.totals && Object.keys(data.data.totals).length > 0 && (
                    <tfoot><tr className="bg-slate-100 font-semibold">{data.data.columns.map((c: any, i: number) => (
                      <Td key={c.key} align="right">{i === 0 ? 'Total' : data.data.totals[c.key] ? inr(data.data.totals[c.key]) : ''}</Td>
                    ))}</tr></tfoot>
                  )}
                </Table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function AuditTrail() {
  const { can } = usePayrollMeta();
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, error, loading } = useLoad(() => (can('payroll.audit') ? payrollApi.get<any[]>(`audit${qs({ search, entity_type: entity, from, to, limit: 500 })}`).then((r) => r.data) : Promise.resolve([])), [search, entity, from, to]);
  if (!can('payroll.audit')) return <Card><p className="text-sm text-slate-500">The audit trail is available to Auditor, HR, Finance and Payroll Admin roles.</p></Card>;
  return (
    <Card padded={false}>
      <div className="flex flex-wrap gap-3 p-4">
        <div className="w-72"><SearchBox value={search} onChange={setSearch} placeholder="Search action, record or person" /></div>
        <div className="w-56"><Select value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="All records"
          options={['SalaryComponent', 'SalaryStructure', 'EmployeePayrollProfile', 'CompensationRevision', 'EmployeeCompensation', 'PayrollPeriod', 'PayrollInput', 'AttendancePayrollInput', 'PayrollRun', 'PayrollException', 'PayrollOverride', 'PayrollOutput', 'StatutoryRule', 'PayGroup'].map((v) => ({ value: v, label: v }))} /></div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>
      <ErrorBanner error={error} />
      {loading ? <Spinner /> : (
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Details</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(data ?? []).map((a) => (
              <tr key={a.id} className="align-top">
                <Td>{fmtDateTime(a.created_at)}</Td><Td>{a.actor}</Td><Td className="font-medium">{a.action.replace(/[._]/g, ' ')}</Td>
                <Td className="text-xs">{a.entity_type}<div className="font-mono text-slate-400">{a.entity_id.slice(0, 13)}</div></Td>
                <Td className="whitespace-normal text-xs">
                  {a.summary}
                  {a.diff?.changes && (
                    <details><summary className="cursor-pointer text-blue-700">old / new values</summary>
                      <pre className="mt-1 max-w-xl overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(a.diff.changes, null, 2)}</pre></details>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
