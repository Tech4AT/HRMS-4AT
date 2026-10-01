'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import { Empty, LinkButton, Spinner, useLoad } from '@/components/payroll/ui';
import { payrollApi } from '@/lib/payroll/api';

/** "Run Payroll" menu entry: open the latest period that is still in progress. */
export default function RunPayrollEntry() {
  const router = useRouter();
  const { data, loading } = useLoad(() => payrollApi.get<any[]>('periods').then((r) => r.data), []);
  const target = (data ?? []).find((p) => p.status !== 'completed') ?? data?.[0];
  useEffect(() => {
    if (target) router.replace(`/payroll/run/${target.id}?step=${target.status === 'finalized' ? 'completed' : 'attendance'}`);
  }, [target, router]);
  if (loading || target) return <><PayrollTopBar /><Spinner /></>;
  return (
    <>
      <PayrollTopBar />
      <Empty title="No payroll period yet" action={<LinkButton variant="primary" href="/payroll">Create one from the dashboard</LinkButton>}>
        Create the month&apos;s payroll period first.
      </Empty>
    </>
  );
}
