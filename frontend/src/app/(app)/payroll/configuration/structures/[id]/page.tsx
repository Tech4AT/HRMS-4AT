'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Alert, Badge, Button, Card, ErrorBanner, Field, Icons, Input, PageHeader, Select, Spinner, Table, Td, Th,
  cx, fmtDate, fmtDateTime, inr, num, toast, useLoad,
} from '@/components/payroll/ui';
import { PayrollApiError, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

const TYPE_TILE: Record<string, string> = {
  earning: 'bg-emerald-600', deduction: 'bg-rose-600', employer_contribution: 'bg-violet-600',
};

interface Line {
  component: string;
  component_code: string;
  component_name: string;
  component_type: string;
  calculation_type: string;
  value: string;
  base_component_code: string;
  formula_expr: string;
  default_calculation_type: string;
  default_value: string | null;
}

export default function StructureBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const { meta, can } = usePayrollMeta();
  const components = useLoad(() => payrollApi.get<any[]>('components?status=active').then((r) => r.data), []);
  const payGroups = useLoad(() => payrollApi.get<any[]>('pay-groups').then((r) => r.data), []);
  const existing = useLoad(() => (isNew ? Promise.resolve(null) : payrollApi.get<any>(`salary-structures/${id}`).then((r) => r.data)), [id]);
  const versions = useLoad(() => (isNew ? Promise.resolve(null) : payrollApi.get<any>(`salary-structures/${id}/versions`).then((r) => r.data)), [id]);

  const [form, setForm] = useState<any>({
    name: '', code: '', description: '', reference_ctc: '1200000', effective_from: new Date().toISOString().slice(0, 10),
    min_ctc: '', max_ctc: '', pay_group: '', ctc_tolerance: '1',
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    if (!existing.data || loaded.current) return;
    loaded.current = true;
    const s = existing.data;
    setForm({ name: s.name, code: s.code, description: s.description, reference_ctc: s.reference_ctc, effective_from: s.effective_from,
      min_ctc: s.min_ctc ?? '', max_ctc: s.max_ctc ?? '', pay_group: s.pay_group ?? '', ctc_tolerance: s.ctc_tolerance, version: s.version });
    setLines(s.lines.map((l: any) => ({
      component: l.component, component_code: l.component_code, component_name: l.component_name, component_type: l.component_type,
      calculation_type: l.calculation_type || '', value: l.value ?? '', base_component_code: l.base_component_code, formula_expr: l.formula_expr,
      default_calculation_type: l.default_calculation_type, default_value: l.default_value,
    })));
  }, [existing.data]);

  // Live breakup preview (UI 05: annual / monthly / % of CTC).
  useEffect(() => {
    if (!lines.length) { setPreview(null); return; }
    const t = setTimeout(() => {
      payrollApi.post<any>('salary-structures/preview', {
        annual_ctc: form.reference_ctc || 0, ctc_tolerance: form.ctc_tolerance,
        lines: lines.map((l, i) => ({ component_id: l.component, order: i + 1, calculation_type: l.calculation_type || undefined,
          value: l.value === '' ? undefined : l.value, base_component_code: l.base_component_code || undefined, formula_expr: l.formula_expr || undefined })),
      }).then((r) => setPreview(r.data)).catch((e) => setPreview({ valid: false, errors: [e.message], lines: [], totals: {} }));
    }, 350);
    return () => clearTimeout(t);
  }, [lines, form.reference_ctc, form.ctc_tolerance]);

  if (existing.loading || components.loading) return <><PayrollTopBar /><Spinner /></>;

  const status = existing.data?.status ?? 'draft';
  const readOnly = !can('payroll.manage');
  const available = (components.data ?? []).filter((c) => !lines.some((l) => l.component === c.id));
  const byCode: Record<string, any> = Object.fromEntries((preview?.lines ?? []).map((l: any) => [l.code, l]));
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const fields = (error instanceof PayrollApiError ? error.fields : {}) as Record<string, any>;

  const addLine = () => {
    const c = (components.data ?? []).find((x) => x.id === adding);
    if (!c) return;
    setLines([...lines, { component: c.id, component_code: c.code, component_name: c.name, component_type: c.component_type,
      calculation_type: '', value: '', base_component_code: '', formula_expr: '', default_calculation_type: c.calculation_type, default_value: c.value }]);
    setAdding('');
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: number) => {
    const next = [...lines];
    const [item] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + d)), 0, item);
    setLines(next);
  };

  const save = async (activate: boolean) => {
    setBusy(true); setError(null);
    const body: any = {
      ...form, min_ctc: form.min_ctc || null, max_ctc: form.max_ctc || null, pay_group: form.pay_group || null,
      lines: lines.map((l, i) => ({ component_id: l.component, order: i + 1, calculation_type: l.calculation_type,
        value: l.value === '' ? null : l.value, base_component_code: l.base_component_code, formula_expr: l.formula_expr })),
    };
    try {
      let s;
      if (isNew) {
        s = (await payrollApi.post<any>('salary-structures', { ...body, status: activate ? 'active' : 'draft' })).data;
      } else {
        s = (await payrollApi.patch<any>(`salary-structures/${id}`, { ...body, reason })).data;
        if (activate && s.status !== 'active') s = (await payrollApi.post<any>(`salary-structures/${id}/activate`, { reason })).data;
      }
      toast.success(activate ? 'Structure saved and active' : 'Structure saved');
      router.push(`/payroll/configuration/structures/${s.id}`);
      if (!isNew) { loaded.current = false; existing.reload(); versions.reload(); }
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const sections: [string, string][] = [['earning', 'Earnings'], ['deduction', 'Deductions (Employee)'], ['employer_contribution', 'Employer Contribution (CTC)']];
  const totals = preview?.totals ?? {};

  return (
    <>
      <PayrollTopBar />
      <PageHeader
        crumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Configuration', href: '/payroll/configuration' },
          { label: 'Salary Structures', href: '/payroll/configuration?tab=structures' }, { label: isNew ? 'Create' : form.code }]}
        title={isNew ? 'Create Salary Structure' : form.name}
        badge={!isNew && <Badge status={status} />}
        subtitle="Build a reusable compensation structure from configured components. Structures are effective-dated and versioned."
        back="/payroll/configuration?tab=structures"
        actions={!readOnly && (
          <>
            <Button onClick={() => router.push('/payroll/configuration?tab=structures')}>Cancel</Button>
            <Button onClick={() => save(false)} loading={busy}>{status === 'active' ? 'Save new version' : 'Save as Draft'}</Button>
            {status !== 'active' && <Button variant="primary" loading={busy} onClick={() => save(true)}>Save & Activate <Icons.arrowRight className="h-4 w-4" /></Button>}
            {!isNew && status === 'active' && (
              <Button variant="danger" onClick={async () => {
                try { await payrollApi.post(`salary-structures/${id}/deactivate`, {}); toast.success('Structure deactivated'); loaded.current = false; existing.reload(); } catch (e) { toast.error(e); }
              }}>Deactivate</Button>
            )}
          </>
        )} />
      <ErrorBanner error={error} />

      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Structure Name" required error={fields.name}><Input value={form.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} placeholder="General Structure - India" /></Field>
          <Field label="Structure Code" required error={fields.code}><Input value={form.code} disabled={readOnly || !isNew} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="GS-IND-001" /></Field>
          <Field label="CTC (Annual) for preview" required><Input type="number" value={form.reference_ctc} onChange={(e) => set('reference_ctc', e.target.value)} /></Field>
          <Field label="Description"><Input value={form.description} disabled={readOnly} onChange={(e) => set('description', e.target.value)} placeholder="Standard structure for full-time employees" /></Field>
          <Field label="Effective From" required error={fields.effective_from}><Input type="date" value={form.effective_from} disabled={readOnly} onChange={(e) => set('effective_from', e.target.value)} /></Field>
          <Field label="Pay Group"><Select value={form.pay_group ?? ''} disabled={readOnly} placeholder="Any" onChange={(e) => set('pay_group', e.target.value)} options={(payGroups.data ?? []).map((g) => ({ value: g.id, label: g.name }))} /></Field>
          <Field label="Eligible CTC from"><Input type="number" value={form.min_ctc} disabled={readOnly} onChange={(e) => set('min_ctc', e.target.value)} /></Field>
          <Field label="Eligible CTC to"><Input type="number" value={form.max_ctc} disabled={readOnly} onChange={(e) => set('max_ctc', e.target.value)} /></Field>
        </div>
        {!isNew && status === 'active' && !readOnly && (
          <div className="mt-4"><Field label="Reason for change (saved with the new version)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        )}
      </Card>

      <Card title="Component Breakdown" padded={false}
        actions={!readOnly && (
          <div className="flex items-center gap-2">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add component…" className="w-64"
              options={available.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
            <Button size="sm" variant="primary" disabled={!adding} onClick={addLine}><Icons.plus className="h-4 w-4" /> Add</Button>
          </div>
        )}>
        {preview && !preview.valid && (
          <div className="p-4"><Alert tone="red" title="The structure does not reconcile yet">
            <ul className="list-inside list-disc">{preview.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
          </Alert></div>
        )}
        <Table>
          <thead><tr>
            <Th>Component</Th><Th>Type</Th><Th>Calculation</Th><Th align="right">Annual (₹)</Th><Th align="right">Monthly (₹)</Th><Th align="right">% of CTC</Th><Th />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sections.map(([type, label]) => {
              const rows = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.component_type === type);
              if (!rows.length) return null;
              return [
                <tr key={type} className={type === 'earning' ? 'bg-emerald-50' : type === 'deduction' ? 'bg-rose-50' : 'bg-violet-50'}>
                  <Td colSpan={7} className="font-semibold text-slate-800">{label}</Td>
                </tr>,
                ...rows.map(({ l, i }) => {
                  const p = byCode[l.component_code];
                  const calc = l.calculation_type || l.default_calculation_type;
                  return (
                    <tr key={l.component}>
                      <Td>
                        <span className="flex items-center gap-2.5">
                          <span className={cx('h-6 w-6 rounded-md', TYPE_TILE[l.component_type])} />
                          <span className="font-medium text-blue-700">{l.component_name}</span>
                          <span className="text-xs text-slate-400">{l.component_code}</span>
                        </span>
                      </Td>
                      <Td className="capitalize">{l.component_type.replace('_', ' ')}</Td>
                      <Td>
                        {readOnly ? <span>{p?.basis}</span> : (
                          <span className="flex items-center gap-2">
                            <select value={l.calculation_type} onChange={(e) => updateLine(i, { calculation_type: e.target.value })}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                              <option value="">Default: {(meta?.calculation_types ?? []).find((o) => o.value === l.default_calculation_type)?.label ?? l.default_calculation_type}</option>
                              {(meta?.calculation_types ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            {['fixed', 'percent_of_ctc', 'percent_of_component', 'units_rate'].includes(calc) && (
                              <input value={l.value} onChange={(e) => updateLine(i, { value: e.target.value })} placeholder={l.default_value ? num(l.default_value) : 'value'}
                                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                            )}
                            {calc === 'formula' && (
                              <input value={l.formula_expr} onChange={(e) => updateLine(i, { formula_expr: e.target.value })} placeholder="formula"
                                className="w-44 rounded-md border border-slate-300 px-2 py-1 font-mono text-xs" />
                            )}
                          </span>
                        )}
                        {p?.basis && !readOnly && <div className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{p.basis}</div>}
                      </Td>
                      <Td align="right">{p ? (p.input_driven ? <span className="text-xs text-slate-400">Input</span> : Number(p.annual).toLocaleString('en-IN')) : '—'}</Td>
                      <Td align="right">{p ? (p.input_driven ? '—' : Number(p.monthly).toLocaleString('en-IN')) : '—'}</Td>
                      <Td align="right">{p && !p.input_driven ? `${num(p.pct_of_ctc)}%` : ''}</Td>
                      <Td align="right">
                        {!readOnly && (
                          <span className="flex justify-end gap-1 text-slate-400">
                            <button onClick={() => move(i, -1)} className="px-1 hover:text-slate-700" aria-label="Move up">↑</button>
                            <button onClick={() => move(i, 1)} className="px-1 hover:text-slate-700" aria-label="Move down">↓</button>
                            <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="px-1 hover:text-rose-600" aria-label="Remove"><Icons.x className="h-4 w-4" /></button>
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                }),
              ];
            })}
            {lines.length === 0 && <tr><Td colSpan={7} className="py-10 text-center text-slate-500">Add components to build the structure.</Td></tr>}
          </tbody>
          {preview?.valid !== undefined && lines.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                <Td>Total CTC</Td><Td /><Td />
                <Td align="right">{inr(totals.ctc_annual_computed)}</Td><Td align="right">{inr(totals.ctc_monthly_computed)}</Td>
                <Td align="right">100%</Td><Td />
              </tr>
              <tr className="text-sm">
                <Td>Gross earnings</Td><Td /><Td /><Td align="right">{inr(totals.gross_annual)}</Td><Td align="right">{inr(totals.gross_monthly)}</Td><Td align="right">{num(totals.gross_pct_of_ctc)}%</Td><Td />
              </tr>
              <tr className="text-sm">
                <Td>Est. net take home</Td><Td /><Td /><Td align="right">{inr(totals.net_take_home_annual)}</Td><Td align="right">{inr(totals.net_take_home_monthly)}</Td><Td /><Td />
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      {!isNew && versions.data && (
        <Card title="Version History" className="mt-5" padded={false}>
          <Table>
            <thead><tr><Th>Version</Th><Th>Effective from</Th><Th>Reason</Th><Th>By</Th><Th>When</Th><Th>Components</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {versions.data.versions.map((v: any) => (
                <tr key={v.id}><Td>v{v.version}</Td><Td>{fmtDate(v.effective_from)}</Td><Td>{v.change_reason}</Td><Td>{v.created_by?.name ?? 'system'}</Td>
                  <Td>{fmtDateTime(v.created_at)}</Td><Td>{v.snapshot.lines.length}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
