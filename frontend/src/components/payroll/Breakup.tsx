'use client';

import { Badge, Icons, Table, Td, Th, cx, inr, num } from './ui';

const TILE: Record<string, { bg: string; icon: keyof typeof Icons }> = {
  earning: { bg: 'bg-emerald-600', icon: 'layers' },
  deduction: { bg: 'bg-rose-600', icon: 'lock' },
  employer_contribution: { bg: 'bg-violet-600', icon: 'lock' },
};

export function ComponentTile({ type }: { type: string }) {
  const t = TILE[type] ?? TILE.earning;
  const Icon = Icons[t.icon];
  return <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white', t.bg)}><Icon className="h-3.5 w-3.5" /></span>;
}

/** "Salary Structure Breakdown" table (UI 04): sections A/B/C with monthly,
 *  annual, % of CTC and PF/ESI/Taxable flags. */
export function BreakupTable({ breakup }: { breakup: any; view?: 'monthly' | 'annual' }) {
  if (!breakup?.lines?.length) return <div className="p-6 text-sm text-slate-500">No breakup.</div>;
  const totals = breakup.totals ?? {};
  const sections: [string, string, string, string, string, string][] = [
    ['A', 'earning', 'Earnings', 'bg-emerald-50', 'gross_monthly', 'gross_annual'],
    ['B', 'deduction', 'Deductions (Employee)', 'bg-rose-50', 'deductions_monthly', 'deductions_annual'],
    ['C', 'employer_contribution', 'Employer Contribution (CTC)', 'bg-violet-50', 'employer_monthly', 'employer_annual'],
  ];
  let n = 0;
  return (
    <Table>
      <thead><tr>
        <Th>#</Th><Th>Component</Th><Th>Type</Th><Th align="right">Monthly Amount (₹)</Th><Th align="right">Annual Amount (₹)</Th>
        <Th align="right">% of CTC</Th><Th align="center">PF</Th><Th align="center">ESI</Th><Th align="center">Taxable</Th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {sections.map(([letter, type, label, bg, mKey, aKey]) => {
          const rows = breakup.lines.filter((l: any) => l.component_type === type && !l.input_driven);
          if (!rows.length) return null;
          const pctKey = type === 'earning' ? 'gross_pct_of_ctc' : type === 'deduction' ? 'deductions_pct_of_ctc' : 'employer_pct_of_ctc';
          return [
            <tr key={type} className={bg}>
              <Td className="font-bold">{letter}</Td><Td className="font-semibold text-slate-900">{label}</Td><Td />
              <Td align="right" className="font-semibold">{Number(totals[mKey] ?? 0).toLocaleString('en-IN')}</Td>
              <Td align="right" className="font-semibold">{Number(totals[aKey] ?? 0).toLocaleString('en-IN')}</Td>
              <Td align="right" className="font-semibold">{num(totals[pctKey])}%</Td><Td /><Td /><Td />
            </tr>,
            ...rows.map((l: any) => {
              n += 1;
              const isStatPf = l.code.startsWith('PF');
              const isStatEsi = l.code.startsWith('ESI');
              return (
                <tr key={l.code}>
                  <Td>{n}</Td>
                  <Td><span className="flex items-center gap-2"><ComponentTile type={type} /><span className="text-blue-700">{l.name}</span></span></Td>
                  <Td className="capitalize text-slate-500">{type === 'employer_contribution' ? 'Employer' : type}</Td>
                  <Td align="right">{Number(l.monthly).toLocaleString('en-IN')}</Td>
                  <Td align="right">{Number(l.annual).toLocaleString('en-IN')}</Td>
                  <Td align="right">{num(l.pct_of_ctc)}%</Td>
                  <Td align="center">{type === 'earning' ? (l.include_in_pf_wage ? <Badge tone="green" label="Yes" dot={false} /> : 'No') : isStatPf ? <Badge tone="green" label="Yes" dot={false} /> : '-'}</Td>
                  <Td align="center">{type === 'earning' ? (l.include_in_esi_wage ? <Badge tone="green" label="Yes" dot={false} /> : 'No') : isStatEsi ? <Badge tone="green" label="Yes" dot={false} /> : '-'}</Td>
                  <Td align="center">{type === 'earning' ? (l.is_taxable ? 'Yes' : 'No') : '-'}</Td>
                </tr>
              );
            }),
          ];
        })}
      </tbody>
      <tfoot>
        <tr className="bg-slate-100 font-semibold"><Td /><Td>Total CTC</Td><Td />
          <Td align="right">{inr(totals.ctc_monthly_computed)}</Td><Td align="right">{inr(totals.ctc_annual_computed)}</Td><Td align="right">100%</Td><Td /><Td /><Td /></tr>
      </tfoot>
    </Table>
  );
}

/** Current vs Proposed structure card used on the revision screen (UI 08). */
export function StructureColumn({ title, range, breakup, badge }: { title: string; range?: string; breakup: any; badge?: React.ReactNode }) {
  const lines = (breakup?.lines ?? []).filter((l: any) => !l.input_driven && l.component_type !== 'employer_contribution');
  const t = breakup?.totals ?? {};
  const earnings = lines.filter((l: any) => l.component_type === 'earning');
  const deductions = lines.filter((l: any) => l.component_type === 'deduction');
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h3 className="font-bold text-slate-900">{title}</h3>
        <div className="flex items-center gap-2">
          {range && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{range}</span>}
          {badge}
        </div>
      </div>
      {!breakup ? <div className="p-6 text-sm text-slate-500">No current structure.</div> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs font-semibold text-slate-500"><th className="px-4 py-2">Component</th><th className="px-2 py-2 text-right">Monthly (₹)</th><th className="px-4 py-2 text-right">Annual (₹)</th></tr></thead>
          <tbody>
            {earnings.map((l: any) => <Row key={l.code} l={l} />)}
            <tr className="bg-emerald-50 font-semibold"><td className="px-4 py-2">Gross Earnings (A)</td><td className="px-2 py-2 text-right">{Number(t.gross_monthly).toLocaleString('en-IN')}</td><td className="px-4 py-2 text-right">{Number(t.gross_annual).toLocaleString('en-IN')}</td></tr>
            {deductions.map((l: any) => <Row key={l.code} l={l} />)}
            <tr className="bg-rose-50 font-semibold"><td className="px-4 py-2">Total Deductions (B)</td><td className="px-2 py-2 text-right">{Number(t.deductions_monthly).toLocaleString('en-IN')}</td><td className="px-4 py-2 text-right">{Number(t.deductions_annual).toLocaleString('en-IN')}</td></tr>
            <tr className="bg-blue-50 text-base font-bold"><td className="px-4 py-3">Net Take Home (A - B)</td><td className="px-2 py-3 text-right">{Number(t.net_take_home_monthly).toLocaleString('en-IN')}</td><td className="px-4 py-3 text-right">{Number(t.net_take_home_annual).toLocaleString('en-IN')}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ l }: { l: any }) {
  return (
    <tr className="border-t border-slate-50">
      <td className="px-4 py-1.5"><span className="flex items-center gap-2"><ComponentTile type={l.component_type} /><span className="text-blue-700">{l.name}</span></span></td>
      <td className="px-2 py-1.5 text-right tabular-nums">{Number(l.monthly).toLocaleString('en-IN')}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{Number(l.annual).toLocaleString('en-IN')}</td>
    </tr>
  );
}

/** Vertical approval workflow (UI 04/08). */
export function ApprovalWorkflow({ approvals, submittedBy }: { approvals: any[]; submittedBy?: string }) {
  const steps = approvals?.length ? approvals : [
    { stage: 'prepared', stage_label: 'HR/Payroll Prepared', status: 'pending' },
    { stage: 'finance_review', stage_label: 'Finance Review', status: 'pending' },
    { stage: 'final_approval', stage_label: 'Final Approval', status: 'pending' },
  ];
  return (
    <ol className="space-y-4">
      {steps.map((a: any, i: number) => (
        <li key={i} className="flex gap-3">
          <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
            a.status === 'approved' ? 'bg-emerald-600' : a.status === 'pending' ? (steps.findIndex((s: any) => s.status === 'pending') === i ? 'bg-blue-600' : 'bg-slate-300')
              : 'bg-rose-500')}>
            {a.status === 'approved' ? '✓' : i + 1}
          </span>
          <div className="text-sm">
            <div className="font-semibold text-slate-900">{a.stage === 'prepared' ? 'HR / Payroll Prepared' : a.stage_label}</div>
            <div className="text-slate-500">
              {a.status === 'pending' ? 'Pending' : a.status === 'approved' ? `By ${a.approver?.name ?? submittedBy ?? ''}` : `${a.status} by ${a.approver?.name ?? ''}`}
            </div>
            {a.acted_at && <div className="text-xs text-slate-400">{new Date(a.acted_at).toLocaleString('en-GB')}</div>}
            {a.comments && a.stage !== 'prepared' && <div className="text-xs italic text-slate-500">“{a.comments}”</div>}
          </div>
        </li>
      ))}
      <li className="flex gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-300 text-sm font-bold text-white">{steps.length + 1}</span>
        <div className="text-sm"><div className="font-semibold text-slate-900">Effective</div>
          <div className="text-slate-500">{steps.every((s: any) => s.status === 'approved') && approvals?.length ? 'Effective' : 'Not yet effective'}</div></div>
      </li>
    </ol>
  );
}
