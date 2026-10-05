'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApprovalWorkflow, BreakupTable } from '@/components/payroll/Breakup';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Avatar, Badge, Button, Card, ErrorBanner, Field, Icons, Input, KeyValue, PageHeader, Select, Spinner, cx, fmtDate, inr,
  num, toast, useLoad,
} from '@/components/payroll/ui';
import { PayrollApiError, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

const DONUT = ['#2563eb', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16'];

/** Assign Salary Structure to Employee (UI 04). */
export default function AssignStructurePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { meta } = usePayrollMeta();
  const detail = useLoad(() => payrollApi.get<any>(`employees/${employeeId}`).then((r) => r.data), [employeeId]);
  const structures = useLoad(() => payrollApi.get<any[]>('salary-structures?status=active').then((r) => r.data), []);
  const current = detail.data?.compensation?.current;
  const [form, setForm] = useState({
    effective_from: params.get('effective_from') ?? new Date().toISOString().slice(0, 10), structure: '', annual_ctc: '',
    revision_type: '', reason: '', remarks: '',
  });
  const [view, setView] = useState<'monthly' | 'annual'>('monthly');
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detail.data || !structures.data) return;
    setForm((f) => ({
      ...f,
      structure: f.structure || current?.structure || structures.data?.[0]?.id || '',
      annual_ctc: f.annual_ctc || current?.annual_ctc || '',
      revision_type: f.revision_type || (current ? 'annual_revision' : 'new_assignment'),
      effective_from: params.get('effective_from') ?? (current ? f.effective_from : detail.data.employee.date_of_joining ?? f.effective_from),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, structures.data]);

  useEffect(() => {
    if (!form.structure || !form.annual_ctc) { setPreview(null); return; }
    const t = setTimeout(() => {
      payrollApi.post<any>('compensations/preview', { employee: Number(employeeId), structure: form.structure, annual_ctc: form.annual_ctc, effective_from: form.effective_from })
        .then((r) => setPreview(r.data)).catch((e) => setPreview({ proposed: { valid: false, errors: [e.message] } }));
    }, 300);
    return () => clearTimeout(t);
  }, [employeeId, form.structure, form.annual_ctc, form.effective_from]);

  if (detail.loading || structures.loading) return <><PayrollTopBar /><Spinner /></>;
  if (detail.error) return <><PayrollTopBar /><ErrorBanner error={detail.error} /></>;
  const emp = detail.data.employee;
  const profile = detail.data.profile;
  const proposed = preview?.proposed;
  const totals = proposed?.totals ?? {};
  const fields = (error instanceof PayrollApiError ? error.fields : {}) as Record<string, any>;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (send: boolean) => {
    setBusy(true); setError(null);
    try {
      await payrollApi.post('compensations', { employee: Number(employeeId), ...form, submit: send });
      toast.success(send ? 'Submitted for approval' : 'Saved as draft');
      router.push(`/payroll/compensation/${employeeId}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  // Donut: earnings + employer contribution share of CTC.
  const donutParts = (proposed?.lines ?? []).filter((l: any) => l.component_type === 'earning' && !l.input_driven)
    .map((l: any) => ({ label: l.name, pct: Number(l.pct_of_ctc) }));
  donutParts.push({ label: 'Employer Contribution', pct: Number(totals.employer_pct_of_ctc ?? 0) });
  let acc = 0;
  const gradient = donutParts.map((p: any, i: number) => {
    const from = acc; acc += p.pct;
    return `${DONUT[i % DONUT.length]} ${from}% ${acc}%`;
  }).join(', ');

  return (
    <>
      <PayrollTopBar />
      <PageHeader crumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Employee Compensation', href: '/payroll/compensation' }, { label: 'Assign Salary Structure' }]}
        title="Assign Salary Structure" subtitle="Allocate a salary structure to an employee with effective date and approval workflow."
        back={`/payroll/compensation/${employeeId}`}
        actions={<Link href={`/payroll/compensation/${employeeId}?tab=profile`} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"><Icons.users className="h-4 w-4" /> View Employee Profile</Link>} />
      <ErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><Icons.file className="h-5 w-5 text-blue-700" /> Employee Information</span>}>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3"><Avatar name={emp.name} /><div><div className="font-semibold text-slate-900">{emp.name}</div>
                <div className="text-sm text-slate-500">{emp.employee_code} | {emp.department} | {emp.employment_type?.replace('_', '-')}</div></div></div>
              <div className="flex-1"><KeyValue cols={4} items={[['Department', emp.department], ['Location', emp.location], ['Date of Joining', fmtDate(emp.date_of_joining)],
                ['Pay Group', profile?.pay_group_name || '—']]} /></div>
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Icons.edit className="h-5 w-5 text-blue-700" /> Salary Assignment</span>}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label="Effective From" required error={fields.effective_from}><Input type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} /></Field>
              <Field label="Salary Structure" required error={fields.structure}>
                <Select value={form.structure} onChange={(e) => set('structure', e.target.value)} options={(structures.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
              </Field>
              <Field label="Annual CTC (₹)" required error={fields.annual_ctc}><Input type="number" value={form.annual_ctc} onChange={(e) => set('annual_ctc', e.target.value)} /></Field>
              <Field label="Reason for Change"><Select value={form.revision_type} onChange={(e) => set('revision_type', e.target.value)} options={meta?.revision_types ?? []} /></Field>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Reason"><Input value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Annual revision, promotion, lateral hire" /></Field>
              <Field label="Remarks (Optional)"><Input value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field>
            </div>
            {fields.employee && <p className="mt-2 text-sm text-rose-600">{fields.employee}</p>}
          </Card>
          <Card padded={false} title={<span className="flex items-center gap-2"><Icons.layers className="h-5 w-5 text-blue-700" /> Salary Structure Breakdown</span>}
            actions={<div className="flex text-sm">{(['monthly', 'annual'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cx('border-b-2 px-3 py-1 capitalize', view === v ? 'border-blue-600 font-medium text-blue-700' : 'border-transparent text-slate-500')}>{v} View</button>))}</div>}>
            {proposed && !proposed.valid ? <div className="p-4"><ErrorBanner error={{ message: 'Structure does not reconcile at this CTC', fieldMessages: proposed.errors }} /></div>
              : <BreakupTable breakup={proposed} view={view} />}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="CTC Summary (Annual)">
            <div className="flex items-center gap-5">
              <div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: `conic-gradient(${gradient || '#e2e8f0 0 100%'})` }}>
                <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white">
                  <div className="text-lg font-bold text-slate-900">{inr(form.annual_ctc)}</div><div className="text-xs text-slate-500">Total CTC</div>
                </div>
              </div>
              <ul className="flex-1 space-y-1.5 text-sm">
                {donutParts.map((p: any, i: number) => (
                  <li key={p.label} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT[i % DONUT.length] }} />{p.label}</span><span className="text-slate-600">{num(p.pct)}%</span></li>
                ))}
              </ul>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SummaryBox tone="green" label="Total Earnings (A)" value={inr(totals.gross_annual)} sub={`${num(totals.gross_pct_of_ctc)}% of CTC`} />
              <SummaryBox tone="red" label="Total Deductions (B)" value={inr(totals.deductions_annual)} sub={`${num(totals.deductions_pct_of_ctc)}% of CTC`} />
              <SummaryBox tone="purple" label="Employer Contribution (C)" value={inr(totals.employer_annual)} sub={`${num(totals.employer_pct_of_ctc)}% of CTC`} />
              <SummaryBox tone="green" label="Estimated Take Home (per month)" value={inr(totals.net_take_home_monthly)} />
            </div>
          </Card>
          <Card title="Previous Salary History" padded={false}>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500"><th className="px-4 py-2">Effective From</th><th className="px-2 py-2 text-right">CTC (₹)</th><th className="px-2 py-2">Reason</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {detail.data.compensation.history.map((c: any) => (
                  <tr key={c.id}><td className="px-4 py-2">{fmtDate(c.effective_from)}</td><td className="px-2 py-2 text-right">{Number(c.annual_ctc).toLocaleString('en-IN')}</td>
                    <td className="px-2 py-2">{c.revision_type?.replace(/_/g, ' ')}</td><td className="px-4 py-2"><Badge status={c.effective_to ? 'superseded' : 'active'} label={c.effective_to ? 'Revised' : 'Active'} /></td></tr>
                ))}
                {!detail.data.compensation.history.length && <tr><td colSpan={4} className="px-4 py-4 text-slate-500">No previous salary.</td></tr>}
              </tbody>
            </table>
          </Card>
          <Card title="Approval Workflow"><ApprovalWorkflow approvals={[]} /></Card>
          <div className="flex justify-end gap-3">
            <Button onClick={() => router.push(`/payroll/compensation/${employeeId}`)}>Cancel</Button>
            <Button loading={busy} onClick={() => submit(false)}>Save as Draft</Button>
            <Button variant="primary" loading={busy} disabled={!proposed?.valid} onClick={() => submit(true)}><Icons.arrowRight className="h-4 w-4" /> Submit for Approval</Button>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryBox({ tone, label, value, sub }: { tone: 'green' | 'red' | 'purple'; label: string; value: string; sub?: string }) {
  const bg = { green: 'bg-emerald-50 text-emerald-800', red: 'bg-rose-50 text-rose-800', purple: 'bg-violet-50 text-violet-800' }[tone];
  return (
    <div className={cx('rounded-lg p-3', bg)}>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-80">{sub}</div>}
    </div>
  );
}
