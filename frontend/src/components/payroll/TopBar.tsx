'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icons } from './ui';
import { usePayrollMeta } from '@/lib/payroll/meta';

/** "Payroll | legal entity | search" bar that heads every payroll screen. */
export function PayrollTopBar() {
  const { meta } = usePayrollMeta();
  const router = useRouter();
  const [term, setTerm] = useState('');
  const entities = meta?.legal_entities ?? [];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4 border-b border-slate-200 pb-4">
      <h1 className="text-3xl font-bold tracking-tight text-blue-950">Payroll</h1>
      <div className="relative">
        <select className="appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm font-medium text-slate-800">
          {entities.length === 0 && <option>Legal entity</option>}
          {entities.map((e) => <option key={e.value}>{e.label}</option>)}
        </select>
        <Icons.chevronRight className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 rotate-90 text-slate-500" />
      </div>
      <form className="relative ml-auto w-full max-w-sm"
        onSubmit={(e) => { e.preventDefault(); router.push(`/payroll/compensation?search=${encodeURIComponent(term)}`); }}>
        <Icons.search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search employees, reports, etc..."
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none" />
      </form>
    </div>
  );
}
