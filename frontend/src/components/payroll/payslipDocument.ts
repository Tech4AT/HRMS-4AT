import { fmtDate, inr } from './ui';

/** A standalone payslip document (same content as PayslipView) printed from a
 *  hidden frame, so "Save as PDF" produces just the payslip, not the app shell. */

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const amount = (v: unknown) => esc(Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function section(title: string, color: string, lines: any[], total: string, totalLabel: string) {
  const rows = lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${amount(l.amount)}</td></tr>`).join('');
  return `<table><thead><tr><th colspan="2" style="background:${color}">${title}</th></tr>
    <tr class="sub"><th>Component</th><th class="r">Amount (₹)</th></tr></thead>
    <tbody>${rows}<tr class="tot"><td>${totalLabel}</td><td class="r">${amount(total)}</td></tr></tbody></table>`;
}

export function payslipHtml(slip: any): string {
  const p = slip.payload;
  const facts: [string, string][] = [
    ['Employee', `${p.employee.name} (${p.employee.employee_code})`],
    ['Department', p.employee.department || '—'],
    ['Designation', p.employee.designation || '—'],
    ['Pay Period', `${fmtDate(p.period.start)} – ${fmtDate(p.period.end)}`],
    ['Pay Date', fmtDate(p.period.pay_date)],
    ['Working Days', String(Number(p.working_days))],
    ['Payable Days', String(Number(p.payable_days))],
    ['Bank', `${p.bank?.name || '—'} ${p.bank?.account || ''}`],
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(p.employee.employee_code)} ${esc(p.period.label)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; }
  .co { font-size: 18px; font-weight: bold; } .muted { color: #64748b; }
  .title { text-align: right; font-size: 20px; font-weight: bold; }
  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; margin: 14px 0; }
  .facts div span { display: block; color: #64748b; font-size: 11px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; }
  th, td { padding: 6px 10px; text-align: left; } .r { text-align: right; }
  thead th { font-size: 13px; } tr.sub th { font-size: 11px; color: #64748b; background: #fff; }
  tbody td { border-top: 1px solid #f1f5f9; } tr.tot td { font-weight: bold; border-top: 1px solid #cbd5e1; }
  .net { display: flex; justify-content: space-between; align-items: center; background: #eff6ff; padding: 12px 14px; margin-top: 14px; }
  .net b { font-size: 20px; color: #059669; }
  .foot { margin-top: 18px; display: flex; justify-content: space-between; color: #94a3b8; font-size: 10px; }
</style></head><body>
<div class="head"><div><div class="co">${esc(p.company.name)}</div><div class="muted">${esc(p.company.address)}</div>
${p.company.pan ? `<div class="muted">PAN: ${esc(p.company.pan)}${p.company.tan ? ` · TAN: ${esc(p.company.tan)}` : ''}</div>` : ''}</div>
<div><div class="title">Payslip</div><div class="muted" style="text-align:right">${esc(p.period.label)}${slip.version > 1 ? ` · Version ${esc(slip.version)}` : ''}</div></div></div>
<div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
<div class="grid">${section('Earnings', '#ecfdf5', p.earnings, p.gross, 'Total Earnings (A)')}${section('Deductions', '#fff1f2', p.deductions, p.total_deductions, 'Total Deductions (B)')}</div>
<div class="net"><strong style="font-size:15px">Net Pay (A - B)</strong><div style="text-align:right"><b>${esc(inr(p.net_pay, { decimals: true }))}</b><div class="muted">${esc(p.net_pay_words)}</div></div></div>
<div class="foot"><span>This is a system generated payslip and does not require a signature.</span><span>${esc(p.company.name)}</span></div>
</body></html>`;
}

export function printPayslip(slip: any) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(payslipHtml(slip));
  doc.close();
  // The frame's title becomes the suggested PDF file name.
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 50);
}
