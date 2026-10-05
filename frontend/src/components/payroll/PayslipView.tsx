'use client';

import Link from 'next/link';
import { printPayslip } from './payslipDocument';
import { Avatar, Badge, Button, Card, Icons, cx, downloadCsvRows, fmtDate, inr } from './ui';

/** Employee Payslip (UI 06). Used by payroll staff and by the employee (ESS). */
export function PayslipView({ slip, otherMonths, ytd, back, hrefFor }: {
  slip: any; otherMonths: any[]; ytd: any; back: string; hrefFor: (id: string) => string;
}) {
  const p = slip.payload;
  const idx = otherMonths.findIndex((s) => s.id === slip.id);
  const prev = otherMonths[idx + 1];
  const next = idx > 0 ? otherMonths[idx - 1] : undefined;
  const exportExcel = () => downloadCsvRows(`payslip_${p.employee.employee_code}_${p.period.label.replace(' ', '_')}.csv`, ['Section', 'Component', 'Amount'], [
    ['Details', 'Employee', `${p.employee.name} (${p.employee.employee_code})`], ['Details', 'Department', p.employee.department], ['Details', 'Pay Period', `${p.period.start} to ${p.period.end}`],
    ['Details', 'Pay Date', p.period.pay_date], ['Details', 'Working Days', p.working_days], ['Details', 'Payable Days', p.payable_days],
    ...p.earnings.map((l: any) => ['Earnings', l.name, l.amount]), ['Earnings', 'Total Earnings (A)', p.gross],
    ...p.deductions.map((l: any) => ['Deductions', l.name, l.amount]), ['Deductions', 'Total Deductions (B)', p.total_deductions], ['', 'Net Pay (A - B)', p.net_pay],
  ]);
  return (
    <div className="print:m-0">
      <div className="mb-5 flex flex-wrap items-center gap-4 print:hidden">
        <Link href={back} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600"><Icons.arrowLeft className="h-4 w-4" /></Link>
        <div className="flex-1"><h1 className="text-2xl font-bold text-slate-900">Employee Payslip</h1><p className="text-sm text-slate-500">View detailed salary breakdown for {p.period.label}</p></div>
        <div className="flex items-center rounded-lg border border-slate-200 bg-white">
          {prev ? <Link href={hrefFor(prev.id)} className="px-3 py-2"><Icons.chevronLeft className="h-4 w-4" /></Link> : <span className="px-3 py-2 text-slate-300"><Icons.chevronLeft className="h-4 w-4" /></span>}
          <span className="border-x border-slate-200 px-6 py-2 font-medium">{p.period.label}</span>
          {next ? <Link href={hrefFor(next.id)} className="px-3 py-2"><Icons.chevronRight className="h-4 w-4" /></Link> : <span className="px-3 py-2 text-slate-300"><Icons.chevronRight className="h-4 w-4" /></span>}
        </div>
        <Button variant="primary" onClick={() => printPayslip(slip)}><Icons.download className="h-4 w-4" /> Download Payslip</Button>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="mb-4 flex items-start justify-between rounded-lg bg-blue-50/60 p-5">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-900 text-2xl font-black text-white">4</span>
              <div><div className="text-lg font-bold text-slate-900">{p.company.name}</div><div className="text-sm text-slate-500">{p.company.address}</div>
                {p.company.pan && <div className="text-xs text-slate-500">PAN: {p.company.pan}{p.company.tan ? ` · TAN: ${p.company.tan}` : ''}</div>}</div>
            </div>
            <div className="text-right"><div className="text-2xl font-bold text-slate-900">Payslip</div><div className="text-slate-500">{p.period.label}</div>
              <div className="mt-1"><Badge status={slip.status === 'released' ? 'paid' : slip.status} label={slip.status === 'released' ? 'Paid' : slip.status} /></div>
              {slip.version > 1 && <div className="text-xs text-slate-400">Version {slip.version}</div>}</div>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-6 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3"><Avatar name={p.employee.name} /><div><div className="font-bold">{p.employee.name}</div>
              <div className="text-sm text-slate-500">{p.employee.employee_code} | {p.employee.department} | {p.employee.employment_type?.replace('_', '-')}</div></div></div>
            <div className="ml-auto grid grid-cols-4 gap-6 text-sm">
              {[['Pay Period', `${fmtDate(p.period.start)} – ${fmtDate(p.period.end)}`], ['Pay Date', fmtDate(p.period.pay_date)], ['Working Days', Number(p.working_days)], ['Payable Days', Number(p.payable_days)]].map(([k, v]) => (
                <div key={k as string} className="border-l border-slate-200 pl-4"><div className="text-slate-500">{k}</div><div className="font-semibold">{v}</div></div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Section title="Earnings" tone="green" lines={p.earnings} total={p.gross} totalLabel="Total Earnings (A)" />
            <Section title="Deductions" tone="red" lines={p.deductions} total={p.total_deductions} totalLabel="Total Deductions (B)" />
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-blue-50 px-5 py-4">
            <span className="text-xl font-bold text-slate-900">Net Pay (A - B)</span>
            <div className="text-right"><div className="text-3xl font-bold text-emerald-600">{inr(p.net_pay)}</div><div className="text-xs text-slate-500">{p.net_pay_words}</div></div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4 text-sm"><div className="mb-2 flex items-center gap-2 font-semibold"><Icons.bank className="h-5 w-5 text-blue-700" /> Bank Details</div>
              <div className="grid grid-cols-2 gap-2"><div><div className="text-xs text-slate-500">Bank Name</div>{p.bank?.name || '—'}</div><div><div className="text-xs text-slate-500">Account Number</div>{p.bank?.account || '—'}</div></div></div>
            <div className="rounded-lg border border-slate-200 p-4 text-sm"><div className="mb-2 flex items-center gap-2 font-semibold"><Icons.shield className="h-5 w-5 text-blue-700" /> Message from 4AT</div>
              <p className="text-slate-600">Thank you for your continued contribution! For any queries, please reach out to the HR Team.</p></div>
          </div>
          <div className="mt-4 flex justify-between text-xs text-slate-400"><span>This is a system generated payslip and does not require a signature.</span><span>{p.company.name}</span></div>
        </Card>
        <div className="space-y-5 print:hidden">
          <Card title={<span className="flex items-center gap-2"><Icons.file className="h-5 w-5 text-blue-700" /> Download & Share</span>}>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => printPayslip(slip)}><Icons.file className="h-4 w-4" /> Download PDF</Button>
              <Button onClick={exportExcel}><Icons.file className="h-4 w-4" /> Download Excel</Button>
            </div>
          </Card>
          <Card title="Other Month Payslips">
            <ul className="divide-y divide-slate-100 text-sm">
              {otherMonths.slice(0, 6).map((s) => (
                <li key={s.id} className={cx('flex items-center justify-between py-2', s.id === slip.id && 'font-semibold')}>
                  <Link href={hrefFor(s.id)} className="text-slate-800 hover:text-blue-700">{s.period_label}</Link>
                  <Badge status={s.status === 'released' ? 'paid' : s.status} label={s.status === 'released' ? 'Paid' : s.status} />
                  <span>{inr(s.net_pay)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {ytd && (
            <Card title={<span>YTD Summary <span className="text-sm font-normal text-slate-500">({fmtDate(ytd.from)} – {fmtDate(ytd.to)})</span></span>}>
              <dl className="space-y-2 text-sm">
                {[['Total Gross Earnings', ytd.gross], ['Total Deductions', ytd.deductions], ['Net Pay (YTD)', ytd.net], ['Taxable Income (YTD)', ytd.taxable],
                  ...Object.entries(ytd.by_component ?? {}).filter(([k]) => /TDS|PF_EE|ESI_EE/.test(k)).map(([k, v]) => [`${k} (YTD)`, v])].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between border-b border-slate-50 pb-1"><dt className="text-slate-600">{k}</dt><dd className="font-semibold">{inr(v as string)}</dd></div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-slate-400">YTD includes released payslips in the financial year.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, tone, lines, total, totalLabel }: { title: string; tone: 'green' | 'red'; lines: any[]; total: string; totalLabel: string }) {
  const head = tone === 'green' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800';
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className={cx('px-4 py-2.5 font-semibold', head)}>{title}</div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="px-4 py-2">Component</th><th className="px-4 py-2 text-right">Amount (₹)</th></tr></thead>
        <tbody>
          {lines.map((l) => <tr key={l.code} className="border-t border-slate-50"><td className="px-4 py-1.5">{l.name}</td><td className="px-4 py-1.5 text-right tabular-nums">{Number(l.amount).toLocaleString('en-IN')}</td></tr>)}
          <tr className={cx('border-t border-slate-200 text-base font-bold', head)}><td className="px-4 py-2.5">{totalLabel}</td><td className="px-4 py-2.5 text-right">{Number(total).toLocaleString('en-IN')}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
