'use client';

import { useParams } from 'next/navigation';
import { PayslipView } from '@/components/payroll/PayslipView';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import { ErrorBanner, Spinner, useLoad } from '@/components/payroll/ui';
import { payrollApi } from '@/lib/payroll/api';

export default function PayrollPayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useLoad(() => payrollApi.get<any>(`payslips/${id}`).then((r) => r.data), [id]);
  if (loading && !data) return <><PayrollTopBar /><Spinner /></>;
  if (error) return <><PayrollTopBar /><ErrorBanner error={error} /></>;
  return (
    <>
      <PayrollTopBar />
      <PayslipView slip={data} otherMonths={data.other_months} ytd={data.ytd} back={`/payroll/run/${data.period}?step=completed`} hrefFor={(sid) => `/payroll/payslips/${sid}`} />
    </>
  );
}
