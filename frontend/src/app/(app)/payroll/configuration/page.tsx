'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Badge, Button, Card, Drawer, Empty, ErrorBanner, Field, Icons, Input, LinkButton, ReasonDialog, Select, Spinner,
  Table, Td, Textarea, Th, Toggle, YesNo, cx, fmtDate, fmtDateTime, inr, num, toast, useLoad,
} from '@/components/payroll/ui';
import { PayrollApiError, payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

type TabKey = 'components' | 'structures' | 'assign' | 'history' | 'pay-groups' | 'statutory';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'components', label: 'Salary Components' },
  { key: 'structures', label: 'Salary Structures' },
  { key: 'assign', label: 'Assign to Employees' },
  { key: 'history', label: 'Revision History' },
  { key: 'pay-groups', label: 'Pay Groups' },
  { key: 'statutory', label: 'Statutory Rules' },
];

export default function ConfigurationPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as TabKey) || 'components';
  const setTab = (key: TabKey) => router.replace(`/payroll/configuration?tab=${key}`);
  const crumb = TABS.find((t) => t.key === tab)?.label ?? '';

  return (
    <>
      <PayrollTopBar />
      <nav className="mb-2 flex items-center gap-1.5 text-sm text-slate-500">
        <Link href="/payroll" className="hover:text-blue-700">Payroll</Link>
        <Icons.chevronRight className="h-3.5 w-3.5" /> <span>Configuration</span>
        <Icons.chevronRight className="h-3.5 w-3.5" /> <span className="font-medium text-slate-800">{crumb}</span>
      </nav>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => (t.key === 'assign' ? router.push('/payroll/compensation') : setTab(t.key))}
            className={cx('whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium',
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'components' && <ComponentsTab />}
      {tab === 'structures' && <StructuresTab />}
      {tab === 'history' && <RevisionHistoryTab />}
      {tab === 'pay-groups' && <PayGroupsTab />}
      {tab === 'statutory' && <StatutoryTab />}
    </>
  );
}

// =============================================================== components

const TYPE_STYLE: Record<string, { tile: string; icon: keyof typeof Icons; label: string }> = {
  earning: { tile: 'bg-emerald-600', icon: 'layers', label: 'Earning' },
  deduction: { tile: 'bg-rose-600', icon: 'lock', label: 'Deduction' },
  employer_contribution: { tile: 'bg-violet-600', icon: 'lock', label: 'Employer' },
};

function calcText(c: any) {
  switch (c.calculation_type) {
    case 'fixed': return c.value ? `Fixed ${inr(c.value)} / month` : 'As defined';
    case 'percent_of_ctc': return `${num(c.value)}% of Annual CTC`;
    case 'percent_of_component': return `${num(c.value)}% of ${c.base_component_code || 'BASIC'}`;
    case 'formula': return c.formula_expr;
    case 'units_rate': return `Hours × Rate${c.value ? ` (${inr(c.value)})` : ''}`;
    case 'actual': return 'Actual amount';
    case 'rule_based': return c.statutory_rule_code === 'PT' ? 'As per state rules' : c.statutory_rule_code === 'TDS' ? 'As per income tax rules' : 'As per applicable %';
    case 'balancing': return 'Balancing (CTC − others)';
    default: return c.calculation_type;
  }
}

function ComponentsTab() {
  const { can } = usePayrollMeta();
  const [filter, setFilter] = useState<'all' | 'earning' | 'deduction' | 'employer_contribution'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const { data, error, loading, reload } = useLoad(() => payrollApi.get<any[]>('components'), []);
  const items = data?.data ?? [];
  const summary = data?.meta?.summary ?? {};
  const typeOrder: Record<string, number> = { earning: 0, deduction: 1, employer_contribution: 2 };
  const filtered = items.filter((c) => (filter === 'all' || c.component_type === filter)
    && (!search || `${c.code} ${c.name}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => typeOrder[a.component_type] - typeOrder[b.component_type] || a.display_order - b.display_order);
  const selected = items.find((c) => c.id === selectedId) ?? filtered[0];
  const manage = can('payroll.manage');

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Salary Components</h2>
          <p className="text-sm text-slate-500">Create and manage earning, deduction and employer contribution components used in salary structures.</p>
        </div>
        {manage && (
          <Button variant="primary" onClick={() => setEditing({})}><Icons.plus className="h-4 w-4" /> Create Component</Button>
        )}
      </div>
      <ErrorBanner error={error} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryTile tone="green" icon={Icons.layers} value={summary.earning ?? 0} label="Earning Components" onClick={() => setFilter('earning')} />
            <SummaryTile tone="red" icon={Icons.percent} value={summary.deduction ?? 0} label="Deduction Components" onClick={() => setFilter('deduction')} />
            <SummaryTile tone="purple" icon={Icons.bank} value={summary.employer_contribution ?? 0} label="Employer Contribution Components" onClick={() => setFilter('employer_contribution')} />
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
              {([['all', `All (${summary.total ?? 0})`], ['earning', `Earnings (${summary.earning ?? 0})`],
                ['deduction', `Deductions (${summary.deduction ?? 0})`], ['employer_contribution', `Employer Contribution (${summary.employer_contribution ?? 0})`]] as const)
                .map(([key, label]) => (
                  <button key={key} onClick={() => setFilter(key)}
                    className={cx('rounded-md px-3 py-1.5', filter === key ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600')}>
                    {label}
                  </button>
                ))}
            </div>
            <div className="relative w-64">
              <Icons.search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search components..."
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
            </div>
          </div>
          <Card padded={false}>
            {loading ? <Spinner /> : (
              <Table>
                <thead><tr>
                  <Th>Component Name</Th><Th>Type</Th><Th>Category</Th><Th>Taxable</Th><Th>PF</Th><Th>ESI</Th>
                  <Th>Formula / Calculation</Th><Th>Status</Th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((c) => {
                    const style = TYPE_STYLE[c.component_type];
                    const Icon = Icons[style.icon];
                    return (
                      <tr key={c.id} onClick={() => setSelectedId(c.id)}
                        className={cx('cursor-pointer hover:bg-slate-50', selected?.id === c.id && 'bg-blue-50/60')}>
                        <Td>
                          <span className="flex items-center gap-2.5">
                            <span className={cx('flex h-7 w-7 items-center justify-center rounded-md text-white', style.tile)}><Icon className="h-4 w-4" /></span>
                            <span className="font-medium text-blue-700">{c.name}</span>
                          </span>
                        </Td>
                        <Td>{style.label}</Td>
                        <Td className="capitalize">{c.category}</Td>
                        <Td>{c.component_type === 'earning' ? <YesNo value={c.is_taxable} /> : <span className="text-slate-400">–</span>}</Td>
                        <Td>{c.include_in_pf_wage || c.statutory_rule_code?.startsWith('PF') ? <Badge tone="green" label="Yes" /> : c.component_type === 'earning' ? <YesNo value={false} /> : <span className="text-slate-400">–</span>}</Td>
                        <Td>{c.include_in_esi_wage || c.statutory_rule_code?.startsWith('ESI') ? <Badge tone="green" label="Yes" /> : c.component_type === 'earning' ? <YesNo value={false} /> : <span className="text-slate-400">–</span>}</Td>
                        <Td className="max-w-[220px] truncate">{calcText(c)}</Td>
                        <Td><Badge status={c.status} /></Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-slate-500">No components match.</Td></tr>}
                </tbody>
              </Table>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">Showing {filtered.length} of {items.length} components</div>
          </Card>
        </div>
        {selected && <ComponentDetail component={selected} canManage={manage} onEdit={() => setEditing(selected)} onChanged={reload} />}
      </div>
      <ComponentForm open={editing !== null} component={editing} onClose={() => setEditing(null)}
        onSaved={(c) => { setEditing(null); setSelectedId(c.id); reload(); }} />
    </div>
  );
}

function SummaryTile({ tone, icon: Icon, value, label, onClick }: { tone: 'green' | 'red' | 'purple'; icon: any; value: number; label: string; onClick: () => void }) {
  const styles = { green: ['bg-emerald-50', 'bg-emerald-100 text-emerald-600', 'text-emerald-800'],
    red: ['bg-rose-50', 'bg-rose-100 text-rose-600', 'text-rose-800'], purple: ['bg-violet-50', 'bg-violet-100 text-violet-600', 'text-violet-800'] }[tone];
  return (
    <button onClick={onClick} className={cx('flex items-center gap-4 rounded-xl px-5 py-4 text-left', styles[0])}>
      <span className={cx('flex h-12 w-12 items-center justify-center rounded-full', styles[1])}><Icon className="h-6 w-6" /></span>
      <span>
        <span className={cx('block text-2xl font-bold', styles[2])}>{value}</span>
        <span className={cx('block text-sm font-medium', styles[2])}>{label}</span>
      </span>
    </button>
  );
}

function ComponentDetail({ component: c, canManage, onEdit, onChanged }: { component: any; canManage: boolean; onEdit: () => void; onChanged: () => void }) {
  const history = useLoad(() => payrollApi.get<any>(`components/${c.id}/history`).then((r) => r.data), [c.id, c.version]);
  const [confirm, setConfirm] = useState<null | 'activate' | 'deactivate'>(null);
  const style = TYPE_STYLE[c.component_type];
  const Icon = Icons[style.icon];
  const applicability = c.applicability || {};
  return (
    <div className="space-y-4">
      <Card title="Component Details" actions={canManage && <Button size="sm" onClick={onEdit}><Icons.edit className="h-4 w-4" /> Edit</Button>}>
        <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
          <span className={cx('flex h-10 w-10 items-center justify-center rounded-lg text-white', style.tile)}><Icon className="h-5 w-5" /></span>
          <span className="text-xl font-bold text-slate-900">{c.name}</span>
          <Badge status={c.status} />
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          {[['Component Code', c.code], ['Type', style.label], ['Category', c.category], ['Taxable', c.is_taxable ? 'Yes' : 'No'],
            ['Include in PF', c.include_in_pf_wage ? 'Yes' : 'No'], ['Include in ESI', c.include_in_esi_wage ? 'Yes' : 'No'],
            ['Part of CTC', c.part_of_ctc ? 'Yes' : 'No'], ['Prorated', c.is_proratable ? 'Yes' : 'No'], ['LOP applies', c.is_lop_applicable ? 'Yes' : 'No'],
            ['Calculation', calcText(c)], ['Rounding', c.rounding.replace(/_/g, ' ')], ['Payslip Label', c.payslip_label || c.name],
            ['Effective', `${fmtDate(c.effective_from)}${c.effective_to ? ` – ${fmtDate(c.effective_to)}` : ''}`], ['Version', `v${c.version}`],
            ['Used in', c.structures?.join(', ') || '—'], ['Description', c.description || '—']].map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="font-medium capitalize-first text-slate-900">{v}</dd></div>
          ))}
        </dl>
        {canManage && (
          <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
            {c.status === 'active'
              ? <Button size="sm" variant="secondary" onClick={() => setConfirm('deactivate')}>Deactivate</Button>
              : <Button size="sm" variant="success" onClick={() => setConfirm('activate')}>Activate</Button>}
          </div>
        )}
      </Card>
      <Card title="Applicability">
        <div className="grid grid-cols-2 gap-4 text-sm">
          {[['Applicable For', applicability.employment_types?.join(', ') || 'All Employees', Icons.users],
            ['Pay Groups', applicability.pay_groups?.join(', ') || 'All Pay Groups', Icons.wallet],
            ['Locations', applicability.locations?.join(', ') || 'All Locations', Icons.info],
            ['Departments', applicability.departments?.join(', ') || 'All Departments', Icons.bank]].map(([k, v, I]: any) => (
            <div key={k} className="flex items-start gap-2">
              <I className="mt-0.5 h-5 w-5 text-slate-500" />
              <div><div className="text-slate-500">{k}</div><div className="font-medium text-slate-800">{v}</div></div>
            </div>
          ))}
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Icons.history className="h-5 w-5 text-blue-700" /> Component History</span>}>
        {history.loading ? <Spinner /> : (
          <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
            {(history.data?.audit ?? []).slice(0, 8).map((h: any) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-white" />
                <div className="text-sm font-semibold text-slate-800">{h.action.replace('component.', 'Component ').replace(/_/g, ' ')}</div>
                <div className="text-xs text-slate-500">By {h.actor}</div>
                <div className="text-xs text-slate-500">{fmtDateTime(h.at)}</div>
                {h.diff?.reason && <div className="text-xs text-slate-600">Reason: {h.diff.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <ReasonDialog open={confirm !== null} title={confirm === 'deactivate' ? `Deactivate ${c.name}?` : `Activate ${c.name}?`}
        message={confirm === 'deactivate' ? 'It stays in history and past payroll, but cannot be used from its end date. A component used by an active structure cannot be deactivated.' : 'The configuration is validated before activation.'}
        requireReason={confirm === 'deactivate' ? 'Reason' : undefined} variant={confirm === 'deactivate' ? 'danger' : 'primary'}
        confirmLabel={confirm === 'deactivate' ? 'Deactivate' : 'Activate'} onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          try {
            await payrollApi.post(`components/${c.id}/${confirm}`, { reason });
            toast.success(`Component ${confirm}d`); setConfirm(null); onChanged();
          } catch (e) { toast.error(e); }
        }} />
    </div>
  );
}

const EMPTY_COMPONENT = {
  code: '', name: '', payslip_label: '', description: '', component_type: 'earning', category: 'fixed',
  calculation_type: 'fixed', value: '', base_component_code: 'BASIC', formula_expr: '', statutory_rule_code: '',
  is_taxable: true, include_in_pf_wage: false, include_in_esi_wage: false, part_of_ctc: true, part_of_gross: true,
  part_of_net: true, is_proratable: true, is_lop_applicable: true, show_on_payslip: true, rounding: 'nearest_rupee',
  display_order: 100, status: 'active', effective_from: new Date().toISOString().slice(0, 10),
};

function ComponentForm({ open, component, onClose, onSaved }: { open: boolean; component: any; onClose: () => void; onSaved: (c: any) => void }) {
  const { meta } = usePayrollMeta();
  const editing = !!component?.id;
  const [form, setForm] = useState<any>(EMPTY_COMPONENT);
  const [reason, setReason] = useState('');
  const [changeDate, setChangeDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [formulaCheck, setFormulaCheck] = useState<string | null>(null);
  const key = component?.id ?? (open ? 'new' : 'closed');
  useEffect(() => {
    setForm(component?.id ? { ...EMPTY_COMPONENT, ...component, value: component.value ?? '' } : EMPTY_COMPONENT);
    setError(null); setReason(''); setFormulaCheck(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const fields = (error instanceof PayrollApiError ? error.fields : {}) as Record<string, any>;
  const calc = form.calculation_type;

  const save = async () => {
    setBusy(true); setError(null);
    const body: any = { ...form, value: form.value === '' ? null : form.value };
    delete body.id; delete body.created_by; delete body.updated_by; delete body.structures; delete body.created_at; delete body.updated_at;
    try {
      const r = editing
        ? await payrollApi.patch<any>(`components/${component.id}`, { ...body, version: component.version, reason, change_effective_from: changeDate })
        : await payrollApi.post<any>('components', body);
      toast.success(editing ? 'Component updated (new version saved)' : 'Component created');
      onSaved(r.data);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const checkFormula = async () => {
    const r = await payrollApi.post<any>('components/validate-formula', { formula_expr: form.formula_expr, code: form.code });
    setFormulaCheck(r.data.valid ? `Valid. Uses: ${r.data.references.join(', ') || 'constants only'}` : r.data.error);
  };

  return (
    <Drawer open={open} onClose={onClose} width="max-w-2xl" title={editing ? `Edit ${component.name}` : 'Create Component'}
      subtitle="Configuration is effective-dated and every change is versioned and audited."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{editing ? 'Save new version' : 'Create component'}</Button></>}>
      <div className="space-y-4">
        <ErrorBanner error={error} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Component name" required error={fields.name}><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Component code" required error={fields.code} hint="e.g. BASIC, HRA"><Input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} disabled={editing} /></Field>
          <Field label="Type" required error={fields.component_type}>
            <Select value={form.component_type} onChange={(e) => set('component_type', e.target.value)} options={meta?.component_types ?? []} />
          </Field>
          <Field label="Category"><Select value={form.category} onChange={(e) => set('category', e.target.value)} options={meta?.categories ?? []} /></Field>
          <Field label="Calculation type" required error={fields.calculation_type}>
            <Select value={calc} onChange={(e) => set('calculation_type', e.target.value)} options={meta?.calculation_types ?? []} />
          </Field>
          {['fixed', 'percent_of_ctc', 'percent_of_component', 'units_rate'].includes(calc) && (
            <Field label={calc === 'fixed' ? 'Monthly amount (₹)' : calc === 'units_rate' ? 'Rate per unit (₹)' : 'Percentage (%)'} required error={fields.value}>
              <Input type="number" value={form.value} onChange={(e) => set('value', e.target.value)} />
            </Field>
          )}
          {calc === 'percent_of_component' && (
            <Field label="Percentage of component" error={fields.base_component_code}><Input value={form.base_component_code} onChange={(e) => set('base_component_code', e.target.value.toUpperCase())} /></Field>
          )}
          {calc === 'rule_based' && (
            <Field label="Statutory rule" required error={fields.statutory_rule_code}>
              <Select value={form.statutory_rule_code} placeholder="Choose rule" onChange={(e) => set('statutory_rule_code', e.target.value)} options={meta?.statutory_codes ?? []} />
            </Field>
          )}
        </div>
        {calc === 'formula' && (
          <Field label="Formula" required error={fields.formula_expr}
            hint="Use component codes and CTC, CTC_M, GROSS, PD, WD, LOP, U, RATE. Functions: min, max, round, floor, ceil.">
            <div className="flex gap-2">
              <Input value={form.formula_expr} onChange={(e) => { set('formula_expr', e.target.value); setFormulaCheck(null); }} placeholder="min(BASIC, 15000) * 0.12" />
              <Button onClick={checkFormula}>Validate</Button>
            </div>
            {formulaCheck && <div className="mt-1 text-xs text-slate-600">{formulaCheck}</div>}
          </Field>
        )}
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-800">Flags</div>
          <div className="grid grid-cols-2 gap-3">
            {[['is_taxable', 'Taxable'], ['include_in_pf_wage', 'Include in PF wage'], ['include_in_esi_wage', 'Include in ESI wage'],
              ['part_of_ctc', 'Part of CTC'], ['part_of_gross', 'Part of gross'], ['part_of_net', 'Paid in net pay'],
              ['is_proratable', 'Prorate for joiners/exits'], ['is_lop_applicable', 'Reduce for LOP'], ['show_on_payslip', 'Show on payslip']].map(([k, label]) => (
              <Toggle key={k} checked={!!form[k]} onChange={(v) => set(k, v)} label={label} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Payslip label"><Input value={form.payslip_label} onChange={(e) => set('payslip_label', e.target.value)} /></Field>
          <Field label="Rounding"><Select value={form.rounding} onChange={(e) => set('rounding', e.target.value)} options={meta?.rounding ?? []} /></Field>
          <Field label="Effective from" required error={fields.effective_from}><Input type="date" value={form.effective_from} onChange={(e) => set('effective_from', e.target.value)} /></Field>
          <Field label="Display order"><Input type="number" value={form.display_order} onChange={(e) => set('display_order', e.target.value)} /></Field>
          {!editing && <Field label="Status"><Select value={form.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }]} /></Field>}
        </div>
        <Field label="Description"><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
        {editing && (
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-blue-50 p-4">
            <Field label="Change effective from" hint="Payroll uses the new version from this date."><Input type="date" value={changeDate} onChange={(e) => setChangeDate(e.target.value)} /></Field>
            <Field label="Reason for change"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Drawer>
  );
}

// =============================================================== structures

function StructuresTab() {
  const { can } = usePayrollMeta();
  const { data, error, loading } = useLoad(() => payrollApi.get<any[]>('salary-structures').then((r) => r.data), []);
  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Salary Structures</h2>
          <p className="text-sm text-slate-500">Reusable, effective-dated structures built from active components.</p>
        </div>
        {can('payroll.manage') && <LinkButton variant="primary" href="/payroll/configuration/structures/new"><Icons.plus className="h-4 w-4" /> Create Structure</LinkButton>}
      </div>
      <ErrorBanner error={error} />
      {loading ? <Spinner /> : !data?.length ? <Empty title="No salary structures yet">Create a structure from your salary components.</Empty> : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Structure</Th><Th>Code</Th><Th>Components</Th><Th align="right">CTC range</Th><Th align="right">Employees</Th><Th>Effective</Th><Th>Version</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td><Link href={`/payroll/configuration/structures/${s.id}`} className="font-medium text-blue-700">{s.name}</Link><div className="text-xs text-slate-500">{s.description}</div></Td>
                  <Td>{s.code}</Td>
                  <Td>{s.lines.length}</Td>
                  <Td align="right">{s.min_ctc || s.max_ctc ? `${inr(s.min_ctc ?? 0)} – ${s.max_ctc ? inr(s.max_ctc) : 'any'}` : 'Any'}</Td>
                  <Td align="right">{s.employee_count}</Td>
                  <Td>{fmtDate(s.effective_from)}</Td>
                  <Td>v{s.version}</Td>
                  <Td><Badge status={s.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function RevisionHistoryTab() {
  const { data, error, loading } = useLoad(() => payrollApi.get<any[]>('compensations').then((r) => r.data), []);
  return (
    <Card title="Compensation Revision History" padded={false}>
      <ErrorBanner error={error} />
      {loading ? <Spinner /> : (
        <Table>
          <thead><tr><Th>Employee</Th><Th>Type</Th><Th>Effective</Th><Th>Structure</Th><Th align="right">Previous CTC</Th><Th align="right">New CTC</Th><Th>Reason</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(data ?? []).map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link className="font-medium text-blue-700" href={`/payroll/compensation/${r.employee.id}`}>{r.employee.name}</Link><div className="text-xs text-slate-500">{r.employee.employee_code}</div></Td>
                <Td>{r.type_label}</Td><Td>{fmtDate(r.effective_from)}</Td><Td>{r.structure_code}</Td>
                <Td align="right">{r.current_compensation ? inr(r.current_compensation.annual_ctc) : '—'}</Td>
                <Td align="right">{inr(r.annual_ctc)}</Td><Td>{r.reason}</Td><Td><Badge status={r.status} label={r.status_label} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// =============================================================== pay groups

function PayGroupsTab() {
  const { meta, can } = usePayrollMeta();
  const { data, error, loading, reload } = useLoad(() => payrollApi.get<any[]>('pay-groups').then((r) => r.data), []);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [err, setErr] = useState<unknown>(null);
  const open = (g: any) => {
    setEditing(g);
    setErr(null);
    setForm(g.id ? { ...g } : { code: '', name: '', legal_entity: meta?.legal_entities[0]?.value ?? '', proration_basis: 'calendar_days',
      default_working_days: 22, pay_day: 0, cutoff_day: 25, mid_period_revision_policy: 'split', attendance_policy: 'warn',
      net_pay_rounding: 'nearest_rupee', variance_threshold_pct: 10, large_input_threshold: 100000,
      approval_stages: ['finance_review', 'final_approval'], require_warning_acknowledgement: true, is_active: true });
  };
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const save = async () => {
    try {
      if (editing.id) await payrollApi.patch(`pay-groups/${editing.id}`, form);
      else await payrollApi.post('pay-groups', form);
      toast.success('Pay group saved'); setEditing(null); reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div><h2 className="text-2xl font-bold text-slate-900">Pay Groups</h2><p className="text-sm text-slate-500">Payroll calendar and the policies the calculation uses (proration, revisions, approvals).</p></div>
        {can('payroll.manage') && <Button variant="primary" onClick={() => open({})}><Icons.plus className="h-4 w-4" /> Create Pay Group</Button>}
      </div>
      <ErrorBanner error={error} />
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(data ?? []).map((g) => (
            <Card key={g.id} title={<span>{g.name} <span className="text-sm font-normal text-slate-500">({g.code})</span></span>}
              actions={can('payroll.manage') && <Button size="sm" onClick={() => open(g)}><Icons.edit className="h-4 w-4" /> Edit</Button>}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[['Legal entity', g.legal_entity_name], ['Employees', g.employee_count], ['Proration basis', g.proration_basis.replace(/_/g, ' ')],
                  ['Working days (default)', g.default_working_days], ['Mid-period revision', g.mid_period_revision_policy === 'split' ? 'Split period' : 'Next period'],
                  ['Missing attendance', g.attendance_policy === 'block' ? 'Blocks finalization' : 'Warning'], ['Variance threshold', `${num(g.variance_threshold_pct)}%`],
                  ['Approval stages', (g.approval_stages?.length ? g.approval_stages : ['finance_review', 'final_approval']).map((s: string) => s.replace('_', ' ')).join(' → ')],
                  ['Finance Reviewer', meta?.approver_candidates?.finance_review?.find((u) => u.value === g.finance_reviewer)?.label ?? 'Automatic'],
                  ['Final Approver', meta?.approver_candidates?.final_approval?.find((u) => u.value === g.final_approver)?.label ?? 'Automatic']].map(([k, v]) => (
                  <div key={k as string}><dt className="text-slate-500">{k}</dt><dd className="font-medium capitalize text-slate-900">{v}</dd></div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : 'Create Pay Group'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <ErrorBanner error={err} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" required><Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Code" required><Input value={form.code ?? ''} onChange={(e) => set('code', e.target.value.toUpperCase())} /></Field>
            <Field label="Legal entity" required><Select value={form.legal_entity ?? ''} onChange={(e) => set('legal_entity', e.target.value)} options={(meta?.legal_entities ?? []).map((l) => ({ value: l.value, label: l.label }))} /></Field>
            <Field label="Proration basis"><Select value={form.proration_basis} onChange={(e) => set('proration_basis', e.target.value)} options={meta?.proration_bases ?? []} /></Field>
            <Field label="Default working days"><Input type="number" value={form.default_working_days ?? ''} onChange={(e) => set('default_working_days', e.target.value)} /></Field>
            <Field label="Pay day (0 = month end)"><Input type="number" value={form.pay_day ?? 0} onChange={(e) => set('pay_day', e.target.value)} /></Field>
            <Field label="Mid-period revision"><Select value={form.mid_period_revision_policy} onChange={(e) => set('mid_period_revision_policy', e.target.value)} options={[{ value: 'split', label: 'Split the period' }, { value: 'next_period', label: 'Apply from next period' }]} /></Field>
            <Field label="Missing attendance"><Select value={form.attendance_policy} onChange={(e) => set('attendance_policy', e.target.value)} options={[{ value: 'warn', label: 'Warning' }, { value: 'block', label: 'Block finalization' }]} /></Field>
            <Field label="Net pay rounding"><Select value={form.net_pay_rounding} onChange={(e) => set('net_pay_rounding', e.target.value)} options={meta?.rounding ?? []} /></Field>
            <Field label="Variance threshold %"><Input type="number" value={form.variance_threshold_pct ?? ''} onChange={(e) => set('variance_threshold_pct', e.target.value)} /></Field>
            <Field label="Large input threshold (₹)"><Input type="number" value={form.large_input_threshold ?? ''} onChange={(e) => set('large_input_threshold', e.target.value)} /></Field>
            <Field label="Finance Reviewer" hint="Receives Finance Review requests in the Approvals inbox">
              <Select value={form.finance_reviewer ?? ''} placeholder="Automatic (Finance Reviewer role)" onChange={(e) => set('finance_reviewer', e.target.value || null)}
                options={meta?.approver_candidates?.finance_review ?? []} />
            </Field>
            <Field label="Final Approver" hint="Receives Final Approval requests in the Approvals inbox">
              <Select value={form.final_approver ?? ''} placeholder="Automatic (Payroll Approver role)" onChange={(e) => set('final_approver', e.target.value || null)}
                options={meta?.approver_candidates?.final_approval ?? []} />
            </Field>
          </div>
          <Toggle checked={!!form.require_warning_acknowledgement} onChange={(v) => set('require_warning_acknowledgement', v)} label="Warnings must be acknowledged before submitting for approval" />
        </div>
      </Drawer>
    </div>
  );
}

// =============================================================== statutory

function StatutoryTab() {
  const { meta, can } = usePayrollMeta();
  const { data, error, loading, reload } = useLoad(() => payrollApi.get<any[]>('statutory-rules').then((r) => r.data), []);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [params, setParams] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const open = (r: any) => {
    setEditing(r); setErr(null);
    setForm(r.id ? { ...r } : { code: 'PF_EMPLOYEE', name: '', state: '', status: 'active', effective_from: new Date().toISOString().slice(0, 10) });
    setParams(JSON.stringify(r.params ?? { rate_pct: 12 }, null, 2));
  };
  const save = async () => {
    try {
      const body = { ...form, params: JSON.parse(params) };
      delete body.reviewed_by;
      if (editing.id) await payrollApi.patch(`statutory-rules/${editing.id}`, body);
      else await payrollApi.post('statutory-rules', body);
      toast.success('Rule saved. It needs compliance review again.'); setEditing(null); reload();
    } catch (e) { setErr(e instanceof SyntaxError ? new Error('Parameters must be valid JSON') : e); }
  };
  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div><h2 className="text-2xl font-bold text-slate-900">Statutory Rules</h2><p className="text-sm text-slate-500">Rates, ceilings and slabs are configuration, effective-dated, never hard-coded.</p></div>
        {can('payroll.manage') && <Button variant="primary" onClick={() => open({})}><Icons.plus className="h-4 w-4" /> Add Rule</Button>}
      </div>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Seeded values are illustrative placeholders. Each rule must be reviewed and signed off by the payroll/compliance owner before production payroll relies on it.
      </div>
      <ErrorBanner error={error} />
      {loading ? <Spinner /> : (
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Rule</Th><Th>Code</Th><Th>State</Th><Th>Parameters</Th><Th>Effective</Th><Th>Version</Th><Th>Review</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(data ?? []).map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-slate-900">{r.name}</Td><Td>{r.code}</Td><Td>{r.state || 'All'}</Td>
                  <Td className="max-w-xs truncate font-mono text-xs">{JSON.stringify(r.params)}</Td>
                  <Td>{fmtDate(r.effective_from)}</Td><Td>v{r.version}</Td>
                  <Td>{r.is_reviewed ? <Badge tone="green" label={`Reviewed by ${r.reviewed_by?.name ?? ''}`} /> : <Badge tone="amber" label="Not reviewed" />}</Td>
                  <Td align="right">
                    <span className="flex justify-end gap-2">
                      {can('payroll.manage') && <Button size="sm" onClick={() => open(r)}>Edit</Button>}
                      {can('payroll.approve') && !r.is_reviewed && (
                        <Button size="sm" variant="success" onClick={async () => {
                          try { await payrollApi.post(`statutory-rules/${r.id}/review`, {}); toast.success('Rule signed off'); reload(); } catch (e) { toast.error(e); }
                        }}>Sign off</Button>
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit statutory rule' : 'Add statutory rule'}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        <div className="space-y-4">
          <ErrorBanner error={err} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rule"><Select value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} options={meta?.statutory_codes ?? []} /></Field>
            <Field label="Name"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="State (blank = all)"><Input value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
            <Field label="Effective from"><Input type="date" value={form.effective_from ?? ''} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
          </div>
          <Field label="Parameters (JSON)" hint='PF/ESI: {"rate_pct": 12, "wage_ceiling": 15000}. PT: {"slabs": [{"from": 0, "to": 15000, "amount": 0}]}'>
            <Textarea rows={10} className="font-mono text-xs" value={params} onChange={(e) => setParams(e.target.value)} />
          </Field>
          <Field label="Notes"><Textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Drawer>
    </div>
  );
}
