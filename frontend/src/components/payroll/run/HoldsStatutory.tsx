'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Badge, Button, Card, Drawer, EmployeeCell, ErrorBanner, Field, Icons, Input, ReasonDialog, Select, Spinner, StatCard, Table,
  Td, Textarea, Th, fmtDateTime, inr, toast, useLoad,
} from '../ui';
import { idempotencyKey, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';
import { LockedNotice, StepFooter, StepHeader, type StepProps } from './common';

/** Step 5 — Holds, Arrears & Adjustments. */
export function HoldsStep(props: StepProps) {
  const { periodId, locked } = props;
  const { can } = usePayrollMeta();
  const actions = useLoad(() => payrollApi.get<any[]>(`periods/${periodId}/employee-actions`).then((r) => r.data), [periodId]);
  const overrides = useLoad(() => payrollApi.get<any[]>(`periods/${periodId}/overrides`).then((r) => r.data), [periodId]);
  const arrears = useLoad(() => payrollApi.get<any[]>(`periods/${periodId}/inputs?type=arrears`).then((r) => r.data), [periodId]);
  const population = useLoad(() => payrollApi.get<any[]>(`periods/${periodId}/population`).then((r) => r.data), [periodId]);
  const components = useLoad(() => payrollApi.get<any[]>('components?status=active').then((r) => r.data), []);
  const [holdOpen, setHoldOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [release, setRelease] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ employee: '', reason: '', component: '', amount: '' });
  const [error, setError] = useState<unknown>(null);
  const holds = (actions.data ?? []).filter((a) => a.decision === 'hold' || a.decision === 'ff_pending');

  if (actions.loading && !actions.data) return <Spinner />;
  return (
    <div>
      <StepHeader number={5} title="Holds, Arrears & Adjustments" subtitle="Hold salaries, review arrears and apply authorised component overrides with a reason."
        actions={!locked && (<>
          <Button onClick={() => { setForm({ employee: '', reason: '' }); setError(null); setHoldOpen(true); }}><Icons.lock className="h-4 w-4" /> Hold Salary</Button>
          {can('payroll.override') && <Button variant="primary" onClick={() => { setForm({ employee: '', component: '', amount: '', reason: '' }); setError(null); setOverrideOpen(true); }}><Icons.edit className="h-4 w-4" /> Add Override</Button>}
        </>)} />
      <LockedNotice locked={props.periodLocked} />
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Salary Holds" value={holds.length} sub="Calculated but not paid" icon={Icons.lock} tone="amber" />
        <StatCard label="Arrears Inputs" value={arrears.data?.length ?? 0} sub={`Total ${inr((arrears.data ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0))}`} icon={Icons.file} tone="blue" />
        <StatCard label="Active Overrides" value={overrides.data?.length ?? 0} sub="Shown as warnings in review" icon={Icons.edit} tone="purple" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Salary Holds" padded={false}>
          <Table>
            <thead><tr><Th>Employee</Th><Th>Kind</Th><Th>Decision</Th><Th>Reason</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {holds.map((h) => (
                <tr key={h.id}><Td><EmployeeCell employee={h.employee} /></Td><Td className="capitalize">{h.kind}</Td><Td><Badge status={h.decision} /></Td><Td>{h.reason}</Td>
                  <Td align="right">{!locked && <Button size="sm" onClick={() => setRelease(h)}>Release</Button>}</Td></tr>
              ))}
              {holds.length === 0 && <tr><Td colSpan={5} className="py-6 text-center text-slate-500">No salaries on hold.</Td></tr>}
            </tbody>
          </Table>
        </Card>
        <Card title="Component Overrides" padded={false}>
          <Table>
            <thead><tr><Th>Employee</Th><Th>Component</Th><Th align="right">Override</Th><Th>Reason</Th><Th>By</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(overrides.data ?? []).map((o) => (
                <tr key={o.id}><Td><EmployeeCell employee={o.employee} /></Td><Td>{o.component_code}</Td><Td align="right">{inr(o.override_amount)}</Td><Td>{o.reason}</Td>
                  <Td className="text-xs">{o.created_by?.name}<div>{fmtDateTime(o.created_at)}</div></Td>
                  <Td align="right">{!locked && can('payroll.override') && <Button size="sm" onClick={async () => {
                    try { await payrollApi.del(`periods/${periodId}/overrides/${o.id}?reason=Removed`); toast.success('Override removed'); overrides.reload(); } catch (e) { toast.error(e); }
                  }}>Remove</Button>}</Td></tr>
              ))}
              {!overrides.data?.length && <tr><Td colSpan={6} className="py-6 text-center text-slate-500">No overrides.</Td></tr>}
            </tbody>
          </Table>
        </Card>
        <Card title="Arrears" padded={false} className="xl:col-span-2">
          <Table>
            <thead><tr><Th>Employee</Th><Th>Original period</Th><Th align="right">Amount</Th><Th>Reason</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(arrears.data ?? []).map((r) => (
                <tr key={r.id}><Td><EmployeeCell employee={r.employee} /></Td><Td>{r.reference_period || '—'}</Td><Td align="right">{inr(r.amount)}</Td><Td>{r.reason}</Td><Td><Badge status={r.status} label={r.status_label} /></Td></tr>
              ))}
              {!arrears.data?.length && <tr><Td colSpan={5} className="py-6 text-center text-slate-500">
                No arrears. Retro salary changes never rewrite a finalized payroll; add the delta as an Arrears input in <Link className="text-blue-700" href={`/payroll/run/${periodId}?step=revisions_variable`}>Salary Revisions, Bonus & OT</Link>.
              </Td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>
      <StepFooter props={props} step="holds_adjustments" back="reimbursements" />

      <Drawer open={holdOpen} onClose={() => setHoldOpen(false)} title="Hold salary"
        footer={<><Button onClick={() => setHoldOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => {
          try { await payrollApi.post(`periods/${periodId}/employee-actions`, { employee: Number(form.employee), kind: 'hold', decision: 'hold', reason: form.reason }); toast.success('Salary held'); setHoldOpen(false); actions.reload(); }
          catch (e) { setError(e); }
        }}>Hold</Button></>}>
        <ErrorBanner error={error} />
        <div className="space-y-4">
          <Field label="Employee" required><Select value={form.employee} placeholder="Choose" onChange={(e) => setForm({ ...form, employee: e.target.value })} options={(population.data ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.employee_code})` }))} /></Field>
          <Field label="Reason" required><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Drawer>
      <Drawer open={overrideOpen} onClose={() => setOverrideOpen(false)} title="Override a calculated component"
        subtitle="The calculated value is kept alongside the override; the override is audited and flagged in review."
        footer={<><Button onClick={() => setOverrideOpen(false)}>Cancel</Button><Button variant="primary" onClick={async () => {
          try { await payrollApi.post(`periods/${periodId}/overrides`, { employee: Number(form.employee), component: form.component, amount: form.amount, reason: form.reason }); toast.success('Override saved. Recalculate to apply.'); setOverrideOpen(false); overrides.reload(); }
          catch (e) { setError(e); }
        }}>Save override</Button></>}>
        <ErrorBanner error={error} />
        <div className="space-y-4">
          <Field label="Employee" required><Select value={form.employee} placeholder="Choose" onChange={(e) => setForm({ ...form, employee: e.target.value })} options={(population.data ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.employee_code})` }))} /></Field>
          <Field label="Component" required><Select value={form.component} placeholder="Choose" onChange={(e) => setForm({ ...form, component: e.target.value })} options={(components.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} /></Field>
          <Field label="Override amount (₹)" required><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Reason" required><Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Drawer>
      <ReasonDialog open={!!release} title="Release salary hold" requireReason="Reason" confirmLabel="Release"
        onClose={() => setRelease(null)} onConfirm={async (reason) => {
          try { await payrollApi.post(`periods/${periodId}/employee-actions`, { employee: release.employee.id, kind: release.kind, decision: release.kind === 'hold' ? 'released' : 'process', reason }); toast.success('Released'); setRelease(null); actions.reload(); }
          catch (e) { toast.error(e); }
        }} />
    </div>
  );
}

const STAT_CODES: { label: string; rule: string[]; kind: 'employee' | 'employer' }[] = [
  { label: 'PF (Employee)', rule: ['PF_EMPLOYEE'], kind: 'employee' },
  { label: 'PF (Employer)', rule: ['PF_EMPLOYER'], kind: 'employer' },
  { label: 'ESI (Employee)', rule: ['ESI_EMPLOYEE'], kind: 'employee' },
  { label: 'ESI (Employer)', rule: ['ESI_EMPLOYER'], kind: 'employer' },
  { label: 'Professional Tax', rule: ['PT'], kind: 'employee' },
  { label: 'TDS', rule: ['TDS'], kind: 'employee' },
  { label: 'LWF', rule: ['LWF_EMPLOYEE', 'LWF_EMPLOYER'], kind: 'employer' },
  { label: 'Gratuity', rule: ['GRATUITY'], kind: 'employer' },
];

/** Step 6 — Statutory Deductions: rule sign-off status + totals of the latest calculation. */
export function StatutoryStep(props: StepProps) {
  const { periodId, period, locked } = props;
  const rules = useLoad(() => payrollApi.get<any[]>('statutory-rules').then((r) => r.data), []);
  const components = useLoad(() => payrollApi.get<any[]>('components?calculation_type=rule_based').then((r) => r.data), []);
  const register = useLoad(() => (period.current_run ? payrollApi.get<any>(`reports/register?period=${periodId}`).then((r) => r.data) : Promise.resolve(null)), [periodId, period.current_run?.id]);
  const [busy, setBusy] = useState(false);
  const codesFor = (rule: string[]) => (components.data ?? []).filter((c) => rule.includes(c.statutory_rule_code)).map((c) => c.code);
  const total = (codes: string[]) => (register.data?.rows ?? []).reduce((a: number, r: any) => a + codes.reduce((s, c) => s + Number(r[c] ?? 0), 0), 0);
  const count = (codes: string[]) => (register.data?.rows ?? []).filter((r: any) => codes.some((c) => Number(r[c] ?? 0) > 0)).length;
  const unreviewed = (rules.data ?? []).filter((r) => r.status === 'active' && !r.is_reviewed);

  return (
    <div>
      <StepHeader number={6} title="Statutory Deductions" subtitle="PF, ESI, PT, TDS, LWF and other statutory components, calculated from effective-dated configuration."
        actions={!locked && (
          <Button variant="primary" loading={busy} onClick={async () => {
            setBusy(true);
            try { await payrollApi.post(`periods/${periodId}/calculate`, {}, { 'Idempotency-Key': idempotencyKey() }); toast.success('Payroll calculated'); props.reload(); register.reload(); }
            catch (e) { toast.error(e); } finally { setBusy(false); }
          }}><Icons.refresh className="h-4 w-4" /> {period.current_run ? 'Recalculate' : 'Calculate payroll'}</Button>
        )} />
      <LockedNotice locked={props.periodLocked} />
      {unreviewed.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {unreviewed.length} statutory rule(s) are not signed off by the payroll/compliance owner ({Array.from(new Set(unreviewed.map((r) => r.code))).join(', ')}). They are used, but every run carries a warning until reviewed. <Link className="font-medium underline" href="/payroll/configuration?tab=statutory">Review rules</Link>
        </div>
      )}
      <ErrorBanner error={register.error} />
      <Card title={period.current_run ? `Statutory totals — run #${period.current_run.run_no}` : 'Statutory totals'} padded={false}>
        {!period.current_run ? <div className="p-6 text-sm text-slate-500">Calculate payroll to see statutory deductions and contributions.</div> : register.loading ? <Spinner /> : (
          <Table>
            <thead><tr><Th>Component</Th><Th>Borne by</Th><Th align="right">Employees</Th><Th align="right">Amount</Th><Th>Rule(s)</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {STAT_CODES.map((s) => {
                const codes = codesFor(s.rule);
                const rulesFor = (rules.data ?? []).filter((r) => s.rule.includes(r.code));
                return (
                  <tr key={s.label}><Td className="font-medium">{s.label}</Td><Td className="capitalize">{s.kind}</Td><Td align="right">{count(codes)}</Td>
                    <Td align="right">{inr(total(codes))}</Td>
                    <Td>{rulesFor.map((r) => <span key={r.id} className="mr-2"><Badge tone={r.is_reviewed ? 'green' : 'amber'} label={`${r.state || 'All'} v${r.version}`} /></span>)}</Td></tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <StepFooter props={props} step="statutory" back="holds_adjustments" />
    </div>
  );
}
