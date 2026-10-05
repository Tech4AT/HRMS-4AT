'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Badge, Button, Card, EmployeeCell, ErrorBanner, PageHeader, ReasonDialog, Spinner, Table, Td, Th, fmtDate, inr, monthLong,
  toast, useLoad,
} from '@/components/payroll/ui';
import { payrollApi } from '@/lib/payroll/api';
import { usePayrollMeta } from '@/lib/payroll/meta';

export default function ApprovalsPage() {
  const { can } = usePayrollMeta();
  const approver = can('payroll.review') || can('payroll.approve');
  const revisions = useLoad(() => payrollApi.get<any[]>(`compensations?${approver ? 'awaiting_me=true' : 'status=pending_approval'}`).then((r) => r.data), [approver]);
  const periods = useLoad(() => payrollApi.get<any[]>('periods').then((r) => r.data.filter((p: any) => p.status === 'pending_approval' || p.status === 'approved')), []);
  const [rejecting, setRejecting] = useState<{ id: string; decision: 'reject' | 'return' } | null>(null);

  const decide = async (id: string, decision: string, comments = '') => {
    try {
      await payrollApi.post(`compensations/${id}/decide`, { decision, comments });
      toast.success(decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Returned');
      setRejecting(null); revisions.reload();
    } catch (e) { toast.error(e); }
  };

  return (
    <>
      <PayrollTopBar />
      <PageHeader crumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Approvals' }]} title="Approvals"
        subtitle="Maker-checker approvals for payroll runs and salary revisions. You cannot approve something you prepared." />
      <Card title="Payroll runs awaiting approval" className="mb-5" padded={false}>
        <ErrorBanner error={periods.error} />
        {periods.loading ? <Spinner /> : (
          <Table>
            <thead><tr><Th>Period</Th><Th>Pay group</Th><Th>Pay date</Th><Th>Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(periods.data ?? []).map((p) => (
                <tr key={p.id}><Td className="font-medium">{monthLong(p.year, p.month)}</Td><Td>{p.pay_group_name}</Td><Td>{fmtDate(p.pay_date)}</Td>
                  <Td><Badge status={p.status} label={p.status_label} /></Td>
                  <Td align="right"><Link className="font-medium text-blue-700" href={`/payroll/run/${p.id}?step=${p.status === 'approved' ? 'finalize' : 'review'}`}>Open</Link></Td></tr>
              ))}
              {!periods.data?.length && <tr><Td colSpan={5} className="py-6 text-center text-slate-500">Nothing awaiting approval.</Td></tr>}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title={approver ? 'Salary revisions awaiting your approval' : 'Salary revisions pending approval'} padded={false}>
        <ErrorBanner error={revisions.error} />
        {revisions.loading ? <Spinner /> : (
          <Table>
            <thead><tr><Th>Employee</Th><Th>Type</Th><Th>Effective</Th><Th align="right">Current CTC</Th><Th align="right">Proposed CTC</Th><Th align="right">Change</Th><Th>Stage</Th><Th>Prepared by</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(revisions.data ?? []).map((r) => {
                const prev = Number(r.current_compensation?.annual_ctc ?? 0);
                const pct = prev ? ((Number(r.annual_ctc) - prev) * 100) / prev : null;
                const stage = r.approvals.find((a: any) => a.status === 'pending');
                return (
                  <tr key={r.id}>
                    <Td><EmployeeCell employee={r.employee} href={`/payroll/compensation/${r.employee.id}`} /></Td>
                    <Td>{r.type_label}</Td><Td>{fmtDate(r.effective_from)}</Td>
                    <Td align="right">{inr(r.current_compensation?.annual_ctc)}</Td><Td align="right">{inr(r.annual_ctc)}</Td>
                    <Td align="right">{pct === null ? 'New' : `${pct.toFixed(1)}%`}</Td>
                    <Td><Badge tone="amber" label={stage?.stage_label ?? r.status_label} /></Td>
                    <Td>{r.created_by?.name}</Td>
                    <Td align="right">
                      {approver && (
                        <span className="flex justify-end gap-2">
                          <Button size="sm" onClick={() => setRejecting({ id: r.id, decision: 'return' })}>Return</Button>
                          <Button size="sm" variant="danger" onClick={() => setRejecting({ id: r.id, decision: 'reject' })}>Reject</Button>
                          <Button size="sm" variant="success" onClick={() => decide(r.id, 'approve')}>Approve</Button>
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {!revisions.data?.length && <tr><Td colSpan={9} className="py-6 text-center text-slate-500">No salary revisions awaiting approval.</Td></tr>}
            </tbody>
          </Table>
        )}
      </Card>
      <ReasonDialog open={!!rejecting} title={rejecting?.decision === 'reject' ? 'Reject revision' : 'Return for changes'} requireReason="Comments"
        variant={rejecting?.decision === 'reject' ? 'danger' : 'primary'} confirmLabel={rejecting?.decision === 'reject' ? 'Reject' : 'Return'}
        onClose={() => setRejecting(null)} onConfirm={(c) => decide(rejecting!.id, rejecting!.decision, c)} />
    </>
  );
}
