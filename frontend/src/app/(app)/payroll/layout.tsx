'use client';

import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { Spinner, Toaster } from '@/components/payroll/ui';
import { PAYROLL_STAFF_PERMISSIONS, usePayrollMeta } from '@/lib/payroll/meta';

/** Payroll section shell: only payroll, HR, finance and audit roles work here.
 *  Employees see their own pay under My Finances. */
export default function PayrollLayout({ children }: { children: ReactNode }) {
  const { meta } = usePayrollMeta();
  if (!meta) return <Spinner label="Loading payroll…" />;
  const staff = PAYROLL_STAFF_PERMISSIONS.some((code) => meta.permissions.includes(code));
  if (!staff) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Payroll is for the payroll team</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your payslips, salary and year-to-date summary are in My Finances.
        </p>
        <Link href="/payslips?tab=pay" className="mt-4 inline-block rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white">
          Go to My Finances
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[1400px] px-1 pb-10">
      <Suspense fallback={<Spinner />}>{children}</Suspense>
      <Toaster />
    </div>
  );
}
