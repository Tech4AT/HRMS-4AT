import type { SalaryBreakup as SalaryBreakupData } from '@/lib/api/onboarding';
import { formatCurrency } from '@/lib/api/onboarding';

type Line = SalaryBreakupData['breakup']['lines'][number];

const num = (v: string | number | undefined) => Number(v ?? 0);

/** Payroll-engine salary breakup (monthly + annual), plus the optional bonus /
 * extra allowance layered on top of the package. Read-only. */
export function SalaryBreakup({ data, currency }: { data: SalaryBreakupData; currency: string }) {
  const lines = data.breakup?.lines ?? [];
  const inCtc = (l: Line) => l.partOfCtc && num(l.annual) !== 0;
  const earnings = lines.filter((l) => l.componentType === 'earning' && inCtc(l));
  const employer = lines.filter((l) => l.componentType === 'employer_contribution' && inCtc(l));
  const deductions = lines.filter((l) => l.componentType === 'deduction' && num(l.annual) !== 0);
  const fmt = (v: string | number) => formatCurrency(v, currency);
  const bonus = num(data.bonus);
  const extra = num(data.extraAllowance);

  const section = (title: string, rows: Line[]) =>
    rows.length > 0 && (
      <>
        <tr className="bg-gray-50">
          <td colSpan={3} className="px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500">{title}</td>
        </tr>
        {rows.map((l) => (
          <tr key={l.code} className="border-b border-gray-100">
            <td className="px-3 py-1.5 text-gray-700">{l.name}</td>
            <td className="px-3 py-1.5 text-right text-gray-700">{fmt(l.monthly)}</td>
            <td className="px-3 py-1.5 text-right text-gray-900">{fmt(l.annual)}</td>
          </tr>
        ))}
      </>
    );

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden text-sm">
      <div className="px-3 py-2 bg-purple-50 text-xs text-purple-800 flex flex-wrap justify-between gap-2">
        <span>Structure: <strong>{data.structure?.name}</strong></span>
        <span>Package (CTC): <strong>{fmt(data.annualPackage)}</strong></span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 text-[11px] uppercase text-gray-500">
            <th className="px-3 py-1.5 text-left font-semibold">Component</th>
            <th className="px-3 py-1.5 text-right font-semibold">Monthly</th>
            <th className="px-3 py-1.5 text-right font-semibold">Annual</th>
          </tr>
        </thead>
        <tbody>
          {section('Earnings', earnings)}
          {section('Employer contributions (in CTC)', employer)}
          {section('Employee deductions (from pay)', deductions)}
          {(bonus > 0 || extra > 0) && (
            <>
              <tr className="bg-gray-50">
                <td colSpan={3} className="px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500">Additional (on top of package)</td>
              </tr>
              {bonus > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5 text-gray-700">Bonus</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">—</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmt(bonus)}</td>
                </tr>
              )}
              {extra > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="px-3 py-1.5 text-gray-700">Extra allowance</td>
                  <td className="px-3 py-1.5 text-right text-gray-400">—</td>
                  <td className="px-3 py-1.5 text-right text-gray-900">{fmt(extra)}</td>
                </tr>
              )}
            </>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-purple-50 font-semibold text-purple-900">
            <td className="px-3 py-2" colSpan={2}>Total compensation (annual)</td>
            <td className="px-3 py-2 text-right">{fmt(data.totalCompensation)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
