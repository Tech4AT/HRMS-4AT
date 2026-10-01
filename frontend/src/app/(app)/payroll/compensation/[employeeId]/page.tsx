'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApprovalWorkflow, StructureColumn } from '@/components/payroll/Breakup';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Alert, Avatar, Badge, Button, Card, ErrorBanner, Field, Icons, Input, LinkButton, ReasonDialog, Select, Spinner, StatCard,
  Table, Td, Textarea, Th, Toggle, cx, fmtDate, fmtDateTime, inr, num, toast, useLoad,
} from '@/components/payroll/ui';
import { PayrollApiError, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

type Tab = 'overview' | 'history' | 'revisions' | 'profile' | 'loans';

export default function EmployeeCompensationPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'overview');
  const { data, error, loading, reload } = useLoad(() => payrollApi.get<any>(`employees/${employeeId}`).then((r) => r.data), [employeeId]);
  if (loading && !data) return <><PayrollTopBar /><Spinner /></>;
  if (error) return <><PayrollTopBar /><ErrorBanner error={error} /></>;
  const emp = data.employee;
  const profile = data.profile;
  const current = data.compensation.current;

  return (
    <>
      <PayrollTopBar />
      <nav className="mb-3 flex items-center gap-1.5 text-sm text-slate-500">
        <a href="/payroll" className="hover:text-blue-700">Payroll</a><Icons.chevronRight className="h-3.5 w-3.5" />
        <a href="/payroll/compensation" className="hover:text-blue-700">Employee Compensation</a><Icons.chevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-slate-800">{emp.name}</span>
      </nav>
      <div className="mb-5 flex flex-wrap items-center gap-5 rounded-xl border border-slate-200 bg-white p-4">
        <button onClick={() => router.push('/payroll/compensation')} className="rounded-lg border border-slate-200 p-2 text-slate-600"><Icons.arrowLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-3">
          <Avatar name={emp.name} />
          <div>
            <div className="flex items-center gap-2"><span className="text-xl font-bold text-slate-900">{emp.name}</span><Badge status={profile?.payroll_status ?? emp.status} /></div>
            <div className="text-sm text-slate-500">{emp.employee_code} | {emp.department} | {emp.employment_type?.replace('_', '-')}</div>
          </div>
        </div>
        <div className="ml-auto grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-5">
          {[['Department', emp.department], ['Location', emp.location], ['Date of Joining', fmtDate(emp.date_of_joining)],
            ['Reporting Manager', emp.manager || '—'], ['Pay Group', profile?.pay_group_name || '—']].map(([k, v]) => (
            <div key={k} className="border-l border-slate-200 pl-4"><div className="text-slate-500">{k}</div><div className="font-medium text-slate-900">{v || '—'}</div></div>
          ))}
        </div>
      </div>
      {data.missing?.length > 0 && (
        <div className="mb-4"><Alert tone="amber" title="Payroll data missing">{data.missing.join(', ')}. Complete the Payroll Profile tab so this employee can be paid.</Alert></div>
      )}
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {([['overview', 'Compensation Overview'], ['history', 'Salary History'], ['revisions', 'Revisions'], ['profile', 'Payroll Profile & Bank'], ['loans', 'Loans & Advances']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600')}>{l}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview data={data} employeeId={employeeId} onChanged={reload} />}
      {tab === 'history' && <History data={data} />}
      {tab === 'revisions' && <Revisions data={data} />}
      {tab === 'profile' && <ProfileTab data={data} employeeId={employeeId} onChanged={reload} />}
      {tab === 'loans' && <Loans data={data} employeeId={employeeId} onChanged={reload} />}
      {!current && tab === 'overview' && null}
    </>
  );
}

function Overview({ data, employeeId, onChanged }: { data: any; employeeId: string; onChanged: () => void }) {
  const { meta, can } = usePayrollMeta();
  const current = data.compensation.current;
  const open = data.revisions.find((r: any) => ['draft', 'pending_approval', 'returned'].includes(r.status));
  const lastApproved = data.revisions.find((r: any) => r.status === 'approved');
  const structures = useLoad(() => payrollApi.get<any[]>('salary-structures?status=active').then((r) => r.data), []);
  const [form, setForm] = useState({ revision_type: 'annual_revision', effective_from: '', annual_ctc: '', structure: '', reason: '', remarks: '' });
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<null | 'reject' | 'return'>(null);

  useEffect(() => {
    if (open) {
      setForm({ revision_type: open.revision_type, effective_from: open.effective_from, annual_ctc: open.annual_ctc, structure: open.structure,
        reason: open.reason, remarks: open.remarks });
    } else if (current) {
      const next = new Date(); next.setMonth(next.getMonth() + 1, 1);
      setForm((f) => ({ ...f, structure: current.structure, annual_ctc: current.annual_ctc, effective_from: next.toISOString().slice(0, 10) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, current?.id]);

  useEffect(() => {
    if (!form.structure || !form.annual_ctc || !form.effective_from) return;
    const t = setTimeout(() => {
      payrollApi.post<any>('compensations/preview', { employee: Number(employeeId), structure: form.structure, annual_ctc: form.annual_ctc, effective_from: form.effective_from })
        .then((r) => setPreview(r.data)).catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [employeeId, form.structure, form.annual_ctc, form.effective_from]);

  if (!current && !open) {
    return (
      <Card title="No salary structure assigned">
        <p className="text-sm text-slate-600">Assign a salary structure and CTC so this employee can be included in payroll.</p>
        {can('payroll.write') && <LinkButton variant="primary" className="mt-3" href={`/payroll/compensation/${employeeId}/assign`}>Assign Salary Structure</LinkButton>}
      </Card>
    );
  }

  const currentCtc = Number(current?.annual_ctc ?? 0);
  const proposedCtc = Number(form.annual_ctc || 0);
  const increase = proposedCtc - currentCtc;
  const increasePct = currentCtc ? (increase * 100) / currentCtc : 0;
  const editable = can('payroll.write') && (!open || ['draft', 'returned'].includes(open.status));
  const canDecide = open?.status === 'pending_approval' && (can('payroll.review') || can('payroll.approve'));
  const totals = current?.breakup?.totals ?? {};
  const fields = (error instanceof PayrollApiError ? error.fields : {}) as Record<string, any>;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (submit: boolean) => {
    setBusy(true); setError(null);
    try {
      if (open) await payrollApi.patch(`compensations/${open.id}`, { ...form, version: open.version, submit });
      else await payrollApi.post('compensations', { employee: Number(employeeId), ...form, submit });
      toast.success(submit ? 'Revision submitted for approval' : 'Revision saved as draft');
      onChanged();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const decide = async (d: string, comments = '') => {
    try {
      await payrollApi.post(`compensations/${open.id}/decide`, { decision: d, comments });
      toast.success(d === 'approve' ? 'Stage approved' : `Revision ${d === 'reject' ? 'rejected' : 'returned'}`);
      setDecision(null); onChanged();
    } catch (e) { toast.error(e); }
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard label="Current CTC (Annual)" value={inr(current?.annual_ctc)} sub={current ? `Effective from ${fmtDate(current.effective_from)}` : ''} icon={Icons.file} tone="blue" />
          <StatCard label="Monthly Gross" value={inr(totals.gross_monthly)} icon={Icons.layers} tone="green" />
          <StatCard label="Net Take Home (Est.)" value={inr(totals.net_take_home_monthly)} icon={Icons.bank} tone="purple" />
          <StatCard label="Last Revision" value={lastApproved ? fmtDate(lastApproved.effective_from) : '—'} icon={Icons.trend} tone="blue"
            trend={lastApproved?.current_compensation ? String(((Number(lastApproved.annual_ctc) - Number(lastApproved.current_compensation.annual_ctc)) * 100) / Number(lastApproved.current_compensation.annual_ctc)) : null} />
        </div>

        <Card padded={false}>
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 p-5">
            <div className="flex items-start gap-3">
              <Icons.file className="mt-1 h-5 w-5 text-blue-700" />
              <div><h3 className="text-lg font-bold text-slate-900">Salary Revision</h3><p className="text-sm text-slate-500">Compare current and proposed compensation with detailed breakup.</p>
                {open && <div className="mt-1"><Badge status={open.status} label={open.status_label} /></div>}</div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Revision Type"><Select value={form.revision_type} disabled={!editable} onChange={(e) => set('revision_type', e.target.value)} options={meta?.revision_types ?? []} /></Field>
              <Field label="Effective From" error={fields.effective_from}><Input type="date" value={form.effective_from} disabled={!editable} onChange={(e) => set('effective_from', e.target.value)} /></Field>
              <Field label="Structure"><Select value={form.structure} disabled={!editable} onChange={(e) => set('structure', e.target.value)} options={(structures.data ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
            </div>
          </div>
          <div className="p-5"><ErrorBanner error={error} /></div>
          <div className="grid grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-[220px_1fr_1fr]">
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="mb-3 font-bold text-slate-900">CTC Summary & Changes</h4>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Current CTC</dt><dd className="font-semibold">{inr(currentCtc)}</dd></div>
                <div><dt className="mb-1 text-slate-500">Proposed CTC</dt><dd><Input type="number" value={form.annual_ctc} disabled={!editable} onChange={(e) => set('annual_ctc', e.target.value)} /></dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Increase Amount</dt><dd className={cx('font-semibold', increase >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{inr(increase)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Increase %</dt><dd><span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{num(increasePct.toFixed(1))}%</span></dd></div>
              </dl>
              <Field label="Revision Reason" className="mt-4"><Input value={form.reason} disabled={!editable} onChange={(e) => set('reason', e.target.value)} /></Field>
              <Field label="Remarks" className="mt-3"><Textarea value={form.remarks} disabled={!editable} onChange={(e) => set('remarks', e.target.value)} /></Field>
            </div>
            <StructureColumn title="Current Structure" breakup={preview?.current?.breakup}
              range={current ? `${fmtDate(current.effective_from)} – ${current.effective_to ? fmtDate(current.effective_to) : 'present'}` : undefined} />
            <StructureColumn title="Proposed Structure" breakup={preview?.proposed?.valid ? preview.proposed : null}
              range={form.effective_from ? `from ${fmtDate(form.effective_from)}` : undefined}
              badge={currentCtc ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{num(increasePct.toFixed(1))}% Increase</span> : undefined} />
          </div>
          {preview?.proposed && !preview.proposed.valid && <div className="px-5 pb-5"><Alert tone="red" title="Proposed structure does not reconcile">{preview.proposed.errors?.join(' ')}</Alert></div>}
        </Card>

        <div className="flex justify-end gap-3">
          {editable && (<>
            {open && <Button onClick={async () => { await payrollApi.post(`compensations/${open.id}/cancel`, { reason: 'Cancelled' }); toast.success('Revision cancelled'); onChanged(); }}>Cancel Revision</Button>}
            <Button loading={busy} onClick={() => save(false)}>Save as Draft</Button>
            <Button variant="primary" loading={busy} onClick={() => save(true)}><Icons.arrowRight className="h-4 w-4" /> Submit for Approval</Button>
          </>)}
          {canDecide && (<>
            <Button variant="danger" onClick={() => setDecision('reject')}>Reject</Button>
            <Button onClick={() => setDecision('return')}>Return for changes</Button>
            <Button variant="success" onClick={() => decide('approve')}>Approve stage</Button>
          </>)}
        </div>
      </div>

      <div className="space-y-5">
        <Card title="Approval Workflow"><ApprovalWorkflow approvals={open?.approvals ?? []} /></Card>
        <Card title="Revision History">
          <ol className="space-y-4">
            {data.compensation.history.map((c: any, i: number) => {
              const prev = data.compensation.history[i + 1];
              const pct = prev ? ((Number(c.annual_ctc) - Number(prev.annual_ctc)) * 100) / Number(prev.annual_ctc) : null;
              return (
                <li key={c.id} className="flex gap-3 text-sm">
                  <span className={cx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', c.effective_to ? 'bg-slate-300' : 'bg-blue-600')} />
                  <span className="w-24 shrink-0 text-slate-600">{fmtDate(c.effective_from)}</span>
                  <span className="flex-1"><span className="font-semibold text-slate-900">CTC {inr(c.annual_ctc)}</span>
                    {pct !== null && <span className="ml-2 rounded bg-emerald-50 px-1.5 text-xs text-emerald-700">+{pct.toFixed(1)}%</span>}
                    <span className="block capitalize text-slate-500">{c.revision_type?.replace(/_/g, ' ')}</span>
                    <span className="block text-xs text-slate-400">By {c.approved_by?.name ?? '—'}</span></span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
      <ReasonDialog open={decision !== null} title={decision === 'reject' ? 'Reject revision' : 'Return revision for changes'} requireReason="Comments"
        variant={decision === 'reject' ? 'danger' : 'primary'} confirmLabel={decision === 'reject' ? 'Reject' : 'Return'}
        onClose={() => setDecision(null)} onConfirm={(c) => decide(decision!, c)} />
    </div>
  );
}

function History({ data }: { data: any }) {
  return (
    <Card title="Salary History" padded={false}>
      <Table>
        <thead><tr><Th>Version</Th><Th>Effective From</Th><Th>Effective To</Th><Th>Structure</Th><Th align="right">Annual CTC</Th><Th align="right">Monthly Gross</Th><Th>Reason</Th><Th>Approved By</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {data.compensation.history.map((c: any) => (
            <tr key={c.id}><Td>v{c.version_no}</Td><Td>{fmtDate(c.effective_from)}</Td><Td>{c.effective_to ? fmtDate(c.effective_to) : 'Present'}</Td>
              <Td>{c.structure_name} <span className="text-xs text-slate-400">v{c.structure_version}</span></Td><Td align="right">{inr(c.annual_ctc)}</Td>
              <Td align="right">{inr(c.breakup?.totals?.gross_monthly)}</Td><Td className="capitalize">{c.revision_type?.replace(/_/g, ' ')} {c.reason && `· ${c.reason}`}</Td>
              <Td>{c.approved_by?.name ?? '—'}</Td><Td><Badge status={c.effective_to ? 'superseded' : c.status} /></Td></tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Revisions({ data }: { data: any }) {
  return (
    <Card title="Revisions" padded={false}>
      <Table>
        <thead><tr><Th>Created</Th><Th>Type</Th><Th>Effective</Th><Th align="right">Current CTC</Th><Th align="right">Proposed CTC</Th><Th>Reason</Th><Th>Approvals</Th><Th>Status</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {data.revisions.map((r: any) => (
            <tr key={r.id}><Td>{fmtDateTime(r.created_at)}</Td><Td>{r.type_label}</Td><Td>{fmtDate(r.effective_from)}</Td>
              <Td align="right">{inr(r.current_compensation?.annual_ctc)}</Td><Td align="right">{inr(r.annual_ctc)}</Td><Td>{r.reason}</Td>
              <Td className="text-xs">{r.approvals.filter((a: any) => a.stage !== 'prepared').map((a: any) => `${a.stage_label}: ${a.status}${a.approver ? ` (${a.approver.name})` : ''}`).join(' · ')}</Td>
              <Td><Badge status={r.status} label={r.status_label} /></Td></tr>
          ))}
          {data.revisions.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-slate-500">No revisions yet.</Td></tr>}
        </tbody>
      </Table>
    </Card>
  );
}

function ProfileTab({ data, employeeId, onChanged }: { data: any; employeeId: string; onChanged: () => void }) {
  const { meta, can } = usePayrollMeta();
  const groups = useLoad(() => payrollApi.get<any[]>('pay-groups').then((r) => r.data), []);
  const p = data.profile;
  const [form, setForm] = useState<any>({
    pay_group: p?.pay_group ?? '', payroll_status: p?.payroll_status ?? 'active', work_state: p?.work_state ?? '', tax_regime: p?.tax_regime ?? 'new',
    pf_applicable: p?.pf_applicable ?? true, esi_applicable: p?.esi_applicable ?? false, pt_applicable: p?.pt_applicable ?? true,
    lwf_applicable: p?.lwf_applicable ?? false, payment_mode: p?.payment_mode ?? 'bank_transfer', effective_from: p?.effective_from ?? data.employee.date_of_joining ?? '',
    remarks: p?.remarks ?? '',
  });
  const [bank, setBank] = useState<any>(data.bank ?? { bank_name: '', bank_account_number: '', bank_ifsc_code: '', bank_account_holder_name: '', payment_method: 'direct_deposit' });
  const [stat, setStat] = useState<any>(data.statutory ?? { pan_number: '', uan_number: '', pf_number: '', esi_number: '' });
  const [error, setError] = useState<unknown>(null);
  const edit = can('payroll.write');
  const saveProfile = async () => {
    setError(null);
    try { await payrollApi.put(`employees/${employeeId}/profile`, { ...form, version: p?.version, pay_group: form.pay_group || null }); toast.success('Payroll profile saved'); onChanged(); }
    catch (e) { setError(e); }
  };
  const saveBank = async () => {
    setError(null);
    try { await payrollApi.put(`employees/${employeeId}/bank-statutory`, { bank, statutory: stat }); toast.success('Bank and statutory details saved'); onChanged(); }
    catch (e) { setError(e); }
  };
  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Payroll Profile" actions={edit && <Button size="sm" variant="primary" onClick={saveProfile}>Save profile</Button>}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Pay Group" required><Select value={form.pay_group} disabled={!edit} placeholder="Choose" onChange={(e) => setForm({ ...form, pay_group: e.target.value })} options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
            <Field label="Payroll Status"><Select value={form.payroll_status} disabled={!edit} onChange={(e) => setForm({ ...form, payroll_status: e.target.value })} options={meta?.payroll_statuses ?? []} /></Field>
            <Field label="Work State" hint="Drives PT / LWF rules"><Input value={form.work_state} disabled={!edit} onChange={(e) => setForm({ ...form, work_state: e.target.value })} /></Field>
            <Field label="Tax Regime"><Select value={form.tax_regime} disabled={!edit} onChange={(e) => setForm({ ...form, tax_regime: e.target.value })} options={[{ value: 'new', label: 'New regime' }, { value: 'old', label: 'Old regime' }]} /></Field>
            <Field label="Payment Mode"><Select value={form.payment_mode} disabled={!edit} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })} options={meta?.payment_modes ?? []} /></Field>
            <Field label="Effective From" hint="A later date keeps the previous profile as history"><Input type="date" value={form.effective_from} disabled={!edit} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[['pf_applicable', 'PF applicable'], ['esi_applicable', 'ESI applicable'], ['pt_applicable', 'PT applicable'], ['lwf_applicable', 'LWF applicable']].map(([k, l]) => (
              <Toggle key={k} checked={!!form[k]} disabled={!edit} onChange={(v) => setForm({ ...form, [k]: v })} label={l} />
            ))}
          </div>
          {data.profile_history.length > 1 && (
            <div className="mt-4 text-xs text-slate-500">History: {data.profile_history.map((h: any) => `${fmtDate(h.effective_from)} (${h.payroll_status})`).join(' → ')}</div>
          )}
        </Card>
        <Card title="Bank & Statutory Details" actions={edit && <Button size="sm" variant="primary" onClick={saveBank}>Save details</Button>}>
          {(data.bank?.is_masked || data.statutory?.is_masked) && <div className="mb-3"><Alert tone="blue">Sensitive values are masked for your role.</Alert></div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bank Name"><Input value={bank.bank_name} disabled={!edit} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} /></Field>
            <Field label="Account Holder"><Input value={bank.bank_account_holder_name} disabled={!edit} onChange={(e) => setBank({ ...bank, bank_account_holder_name: e.target.value })} /></Field>
            <Field label="Account Number"><Input value={bank.bank_account_number} disabled={!edit} onChange={(e) => setBank({ ...bank, bank_account_number: e.target.value })} /></Field>
            <Field label="IFSC Code"><Input value={bank.bank_ifsc_code} disabled={!edit} onChange={(e) => setBank({ ...bank, bank_ifsc_code: e.target.value.toUpperCase() })} /></Field>
            <Field label="PAN" required><Input value={stat.pan_number} disabled={!edit} onChange={(e) => setStat({ ...stat, pan_number: e.target.value.toUpperCase() })} /></Field>
            <Field label="UAN"><Input value={stat.uan_number} disabled={!edit} onChange={(e) => setStat({ ...stat, uan_number: e.target.value })} /></Field>
            <Field label="PF Number"><Input value={stat.pf_number} disabled={!edit} onChange={(e) => setStat({ ...stat, pf_number: e.target.value })} /></Field>
            <Field label="ESI Number"><Input value={stat.esi_number} disabled={!edit} onChange={(e) => setStat({ ...stat, esi_number: e.target.value })} /></Field>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Loans({ data, employeeId, onChanged }: { data: any; employeeId: string; onChanged: () => void }) {
  const { can } = usePayrollMeta();
  const deductionComponents = useLoad(() => payrollApi.get<any[]>('components?type=deduction&status=active').then((r) => r.data), []);
  const [form, setForm] = useState<any>({ deduction_type: 'loan', name: '', total_amount: '', installment_amount: '', installments_remaining: '', start_date: '', component: '' });
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setError(null);
    try { await payrollApi.post('loans', { ...form, employee: Number(employeeId) }); toast.success('Loan added. Instalments post automatically each period.'); onChanged(); }
    catch (e) { setError(e); }
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
      <Card title="Loans & Advances" padded={false}>
        <Table>
          <thead><tr><Th>Name</Th><Th>Type</Th><Th align="right">Total</Th><Th align="right">Instalment</Th><Th align="right">Remaining</Th><Th>Start</Th><Th>Component</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {data.loans.map((l: any) => (
              <tr key={l.id}><Td>{l.name}</Td><Td className="capitalize">{l.deduction_type}</Td><Td align="right">{inr(l.total_amount)}</Td><Td align="right">{inr(l.installment_amount)}</Td>
                <Td align="right">{l.installments_remaining}</Td><Td>{fmtDate(l.start_date)}</Td><Td>{l.component_code}</Td><Td><Badge status={l.is_active ? 'active' : 'inactive'} /></Td></tr>
            ))}
            {data.loans.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-slate-500">No loans or advances.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      {can('payroll.write') && (
        <Card title="Add loan / advance">
          <ErrorBanner error={error} />
          <div className="space-y-3">
            <Field label="Type"><Select value={form.deduction_type} onChange={(e) => setForm({ ...form, deduction_type: e.target.value })} options={[{ value: 'loan', label: 'Loan' }, { value: 'advance', label: 'Advance' }, { value: 'custom', label: 'Custom' }]} /></Field>
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total amount"><Input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} /></Field>
              <Field label="Monthly instalment"><Input type="number" value={form.installment_amount} onChange={(e) => setForm({ ...form, installment_amount: e.target.value })} /></Field>
              <Field label="Instalments"><Input type="number" value={form.installments_remaining} onChange={(e) => setForm({ ...form, installments_remaining: e.target.value })} /></Field>
              <Field label="Start date"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            </div>
            <Field label="Deduction component"><Select value={form.component} placeholder="Choose" onChange={(e) => setForm({ ...form, component: e.target.value })} options={(deductionComponents.data ?? []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Button variant="primary" onClick={add}>Add</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
