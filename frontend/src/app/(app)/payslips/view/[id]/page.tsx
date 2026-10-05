'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { PayslipView } from '@/components/payroll/PayslipView';
import { ErrorBanner, Spinner, useLoad } from '@/components/payroll/ui';
import { payrollApi } from '@/lib/payroll/api';

/** An employee's own released payslip (ESS, reached from My Finances). */
export default function MyPayslipPage() {
  return <Suspense fallback={<Spinner />}><MyPayslip /></Suspense>;
}

function MyPayslip() {
  const { id } = useParams<{ id: string }>();
  const slip = useLoad(() => payrollApi.get<any>(`my/payslips/${id}`).then((r) => r.data), [id]);
  const all = useLoad(() => payrollApi.get<any[]>('my/payslips').then((r) => r.data), []);
  if ((slip.loading && !slip.data) || all.loading) return <Spinner />;
  if (slip.error) return <ErrorBanner error={slip.error} />;
  return (
    <div className="mx-auto w-full max-w-[1400px] p-2">
      <PayslipView slip={slip.data} otherMonths={all.data ?? []} ytd={slip.data.payload.ytd} back="/payslips?tab=pay" hrefFor={(sid) => `/payslips/view/${sid}`} />
    </div>
  );
}
