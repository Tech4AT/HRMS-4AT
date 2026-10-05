'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PayrollTopBar } from '@/components/payroll/TopBar';
import {
  Badge, Card, EmployeeCell, ErrorBanner, Icons, PageHeader, SearchBox, Select, Spinner, StatCard, Table, Td, Th, fmtDate,
  inr, useLoad,
} from '@/components/payroll/ui';
import { payrollApi, qs } from '@/lib/payroll/api';

export default function CompensationListPage() {
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [term, setTerm] = useState(search);
  const [assignment, setAssignment] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(search), 300); return () => clearTimeout(t); }, [search]);
  const { data, error, loading } = useLoad(
    () => payrollApi.get<any[]>(`employees${qs({ search: term, assignment })}`).then((r) => r.data), [term, assignment]);
  const rows = data ?? [];
  const assigned = rows.filter((r) => r.compensation).length;

  return (
    <>
      <PayrollTopBar />
      <PageHeader crumbs={[{ label: 'Payroll', href: '/payroll' }, { label: 'Employee Compensation' }]}
        title="Employee Compensation" subtitle="Assign salary structures, revise pay and maintain payroll profiles. Every change is effective-dated and approved." />
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Employees" value={rows.length} icon={Icons.users} tone="blue" />
        <StatCard label="With salary structure" value={assigned} icon={Icons.layers} tone="green" />
        <StatCard label="Not assigned" value={rows.length - assigned} icon={Icons.alert} tone="amber" />
        <StatCard label="Pending revisions" value={rows.filter((r) => r.has_pending_revision).length} icon={Icons.hourglass} tone="purple" />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="w-80"><SearchBox value={search} onChange={setSearch} placeholder="Search by name, emp ID, department..." /></div>
          <div className="w-52"><Select value={assignment} onChange={(e) => setAssignment(e.target.value)} placeholder="All employees"
            options={[{ value: 'assigned', label: 'Structure assigned' }, { value: 'unassigned', label: 'Not assigned' }]} /></div>
        </div>
        <ErrorBanner error={error} />
        {loading ? <Spinner /> : (
          <Table>
            <thead><tr><Th>Employee</Th><Th>Department</Th><Th>Pay Group</Th><Th>Structure</Th><Th align="right">Annual CTC</Th>
              <Th align="right">Monthly Gross</Th><Th>Effective From</Th><Th>Payroll Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td><EmployeeCell employee={r} href={`/payroll/compensation/${r.id}`} /></Td>
                  <Td>{r.department || '—'}</Td>
                  <Td>{r.pay_group || <span className="text-amber-600">No profile</span>}</Td>
                  <Td>{r.compensation?.structure.name ?? <span className="text-slate-400">Not assigned</span>}</Td>
                  <Td align="right">{inr(r.compensation?.annual_ctc)}</Td>
                  <Td align="right">{inr(r.compensation?.monthly_gross)}</Td>
                  <Td>{fmtDate(r.compensation?.effective_from)}</Td>
                  <Td>{r.payroll_status ? <Badge status={r.payroll_status} /> : '—'}{r.has_pending_revision && <span className="ml-2"><Badge tone="amber" label="Revision pending" /></span>}</Td>
                  <Td align="right">
                    <Link href={r.compensation ? `/payroll/compensation/${r.id}` : `/payroll/compensation/${r.id}/assign`} className="text-sm font-medium text-blue-700">
                      {r.compensation ? 'View' : 'Assign'}
                    </Link>
                  </Td>
                </tr>
              ))}
              {rows.length === 0 && <tr><Td colSpan={9} className="py-10 text-center text-slate-500">No employees found.</Td></tr>}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
