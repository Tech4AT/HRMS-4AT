'use client';

import { useState } from 'react';
import {
  Avatar, Badge, Button, Card, EmployeeCell, ErrorBanner, Field, Icons, Input, Modal, SearchBox, Select, Spinner,
  StatCard, Table, Tabs, Td, Textarea, Th, cx, downloadCsvRows, fmtDateTime, num, toast, useLoad,
} from '../ui';
import { idempotencyKey, payrollApi } from '@/lib/payroll/api';
import { LockedNotice, StepFooter, StepHeader, type StepProps } from './common';

type Tab = 'all' | 'exceptions' | 'leave' | 'ot' | 'pending';

/** Step 1 — Attendance, Leave & Timesheets (UI 15). */
export function AttendanceStep(props: StepProps) {
  const { periodId, locked } = props;
  const { data, error, loading, reload } = useLoad(() => payrollApi.get<any[]>(`periods/${periodId}/attendance`), [periodId]);
  const components = useLoad(() => payrollApi.get<any[]>('components?type=earning&status=active').then((r) => r.data), []);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [otOpen, setOtOpen] = useState(false);

  if (loading && !data) return <Spinner />;
  const rows = data?.data ?? [];
  const s = data?.meta?.summary ?? {};
  const pct = (n: number) => (s.total ? `${((n * 100) / s.total).toFixed(1)}%` : '');
  const departments = Array.from(new Set(rows.map((r) => r.employee.department).filter(Boolean))) as string[];
  const filtered = rows.filter((r) => {
    const a = r.attendance;
    if (tab === 'exceptions' && !['missing', 'pending'].includes(r.status)) return false;
    if (tab === 'leave' && !(a && (Number(a.lop_days) > 0 || Number(a.paid_leave_days) > 0 || Number(a.unpaid_leave_days) > 0))) return false;
    if (tab === 'ot' && !(a && Number(a.ot_hours) > 0)) return false;
    if (tab === 'pending' && !(a && a.pending_leave_requests > 0)) return false;
    if (dept && r.employee.department !== dept) return false;
    if (status && r.status !== status) return false;
    return !search || `${r.employee.name} ${r.employee.employee_code} ${r.employee.department}`.toLowerCase().includes(search.toLowerCase());
  });

  const act = async (path: string, message: string) => {
    setMenu(false);
    try { await payrollApi.post(`periods/${periodId}/${path}`, {}); toast.success(message); reload(); props.reload(); }
    catch (e) { toast.error(e); }
  };

  return (
    <div>
      <StepHeader number={1} title="Attendance, Leave & Timesheets"
        subtitle="Import and review attendance, approved leave, LOP and overtime for this payroll. Payroll uses finalized attendance only."
        actions={!locked && (
          <div className="relative">
            <Button onClick={() => setMenu(!menu)}>Import Attendance <Icons.chevronRight className="h-4 w-4 rotate-90" /></Button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                <MenuItem onClick={() => { setMenu(false); setImporting(true); }}>Import finalized summary (CSV)</MenuItem>
                <MenuItem onClick={() => act('attendance/sync', 'Attendance synced from the attendance module')} disabled={!s.source_connected}>
                  Sync from Attendance module {s.source_connected ? '' : '(not connected)'}
                </MenuItem>
                <MenuItem onClick={() => act('attendance/fill-missing', 'Missing employees marked with full attendance')}>Mark missing as full attendance</MenuItem>
                <MenuItem onClick={() => { setMenu(false); setOtOpen(true); }}>Create OT inputs from approved hours</MenuItem>
                <MenuItem onClick={() => act('snapshot-inputs', 'Attendance snapshot captured')}>Capture attendance snapshot</MenuItem>
              </div>
            )}
          </div>
        )} />
      <LockedNotice locked={props.periodLocked} />
      <ErrorBanner error={error} />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Total Employees" value={s.total ?? 0} icon={Icons.users} tone="blue" />
        <StatCard label="Ready for Payroll" value={s.ready ?? 0} icon={Icons.check} tone="green" sub={pct(s.ready)} />
        <StatCard label="Missing Attendance" value={<span className="text-rose-600">{s.missing ?? 0}</span>} icon={Icons.alert} tone="amber" sub={pct(s.missing)} />
        <StatCard label="With LOP" value={<span className="text-rose-600">{s.with_lop ?? 0}</span>} icon={Icons.clock} tone="red" sub={pct(s.with_lop)} />
        <StatCard label="OT Hours" value={`${num(s.ot_hours)}hrs`} icon={Icons.clock} tone="blue" sub={`${s.ot_employees ?? 0} employees`} />
        <StatCard label="Pending Leave Approval" value={<span className="text-rose-600">{s.pending_leave ?? 0}</span>} icon={Icons.hourglass} tone="amber" />
      </div>
      {s.snapshot && (
        <div className="mb-3 text-xs text-slate-500">Snapshot v{s.snapshot.version} captured {fmtDateTime(s.snapshot.captured_at)} · checksum {s.snapshot.checksum.slice(0, 12)}… {s.snapshot.is_final ? '· final' : '· contains non-final rows'}</div>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <Card padded={false}>
          <div className="px-4 pt-3">
            <Tabs value={tab} onChange={setTab} tabs={[
              { key: 'all', label: 'Employee List' },
              { key: 'exceptions', label: 'Attendance Exceptions', count: (s.missing ?? 0) + (s.pending ?? 0), tone: 'red' },
              { key: 'leave', label: 'Leave Impact', count: s.with_lop ?? 0, tone: 'red' },
              { key: 'ot', label: 'OT Summary' },
              { key: 'pending', label: 'Pending Approvals', count: s.pending_leave ?? 0, tone: 'red' },
            ]} />
          </div>
          <div className="flex flex-wrap gap-3 px-4 pb-3">
            <div className="w-72"><SearchBox value={search} onChange={setSearch} placeholder="Search by name, emp ID, department..." /></div>
            <div className="w-44"><Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="Department" options={departments.map((d) => ({ value: d, label: d }))} /></div>
            <div className="w-40"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Status" options={['ready', 'lop', 'missing', 'pending'].map((v) => ({ value: v, label: v }))} /></div>
            <Button className="ml-auto" onClick={() => downloadCsvRows(`attendance_${periodId}.csv`,
              ['Employee', 'Emp ID', 'Department', 'Payable Days', 'LOP', 'Present', 'OT Hours', 'Status'],
              filtered.map((r) => [r.employee.name, r.employee.employee_code, r.employee.department, r.attendance?.payable_days ?? '', r.attendance?.lop_days ?? '', r.attendance?.present_days ?? '', r.attendance?.ot_hours ?? '', r.status]))}>
              <Icons.download className="h-4 w-4" /> Download
            </Button>
          </div>
          <Table>
            <thead><tr><Th>Employee</Th><Th>Emp ID</Th><Th>Department</Th><Th align="right">Payable Days</Th><Th align="right">LOP</Th><Th align="right">Present</Th><Th align="right">OT Hours</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.employee.id} className={cx('hover:bg-slate-50', selected?.employee.id === r.employee.id && 'bg-blue-50/60')}>
                  <Td><EmployeeCell employee={r.employee} onClick={() => setSelected(r)} /></Td>
                  <Td>{r.employee.employee_code}</Td><Td>{r.employee.department}</Td>
                  <Td align="right">{r.attendance ? num(r.attendance.payable_days) : '—'}</Td>
                  <Td align="right">{r.attendance ? num(r.attendance.lop_days) : '—'}</Td>
                  <Td align="right">{r.attendance ? num(r.attendance.present_days) : '—'}</Td>
                  <Td align="right">{r.attendance && Number(r.attendance.ot_hours) ? `${num(r.attendance.ot_hours)}h` : '-'}</Td>
                  <Td><Badge status={r.status} label={{ ready: 'Ready', lop: 'LOP', missing: 'Missing', pending: 'Pending' }[r.status as string]} /></Td>
                  <Td><button className="text-sm font-medium text-blue-700" onClick={() => setSelected(r)}>View</button></Td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><Td colSpan={9} className="py-8 text-center text-slate-500">No employees in this view.</Td></tr>}
            </tbody>
          </Table>
        </Card>
        <AttendancePanel row={selected} periodId={periodId} locked={locked} onClose={() => setSelected(null)} onSaved={() => { reload(); setSelected(null); }} />
      </div>
      <StepFooter props={props} step="attendance" />
      <ImportModal open={importing} onClose={() => setImporting(false)} periodId={periodId} onDone={() => { setImporting(false); reload(); }} />
      <Modal open={otOpen} onClose={() => setOtOpen(false)} title="Create overtime inputs">
        <p className="mb-3 text-sm text-slate-600">Approved OT hours from finalized attendance become approved overtime inputs (units × component rate). Existing OT inputs are not duplicated.</p>
        <div className="space-y-2">
          {(components.data ?? []).filter((c) => ['units_rate', 'formula'].includes(c.calculation_type)).map((c) => (
            <Button key={c.id} className="w-full justify-between" onClick={async () => {
              try { const r = await payrollApi.post<any>(`periods/${periodId}/inputs/generate-ot`, { component: c.id }); toast.success(`${r.data.created} OT input(s) created`); setOtOpen(false); }
              catch (e) { toast.error(e); }
            }}>{c.name} <span className="text-xs text-slate-500">{c.value ? `₹${num(c.value)}/unit` : 'formula'}</span></Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function MenuItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400">{children}</button>;
}

function AttendancePanel({ row, periodId, locked, onClose, onSaved }: { row: any; periodId: string; locked: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const key = row?.employee.id;
  if (!row) {
    return <Card><div className="py-16 text-center text-sm text-slate-500">Select an employee to see and correct their attendance summary.</div></Card>;
  }
  const a = row.attendance ?? {};
  const f = form && form._key === key ? form : {
    _key: key, working_days: a.working_days ?? '', payable_days: a.payable_days ?? '', lop_days: a.lop_days ?? 0, present_days: a.present_days ?? '',
    paid_leave_days: a.paid_leave_days ?? 0, unpaid_leave_days: a.unpaid_leave_days ?? 0, ot_hours: a.ot_hours ?? 0,
    pending_leave_requests: a.pending_leave_requests ?? 0, status: a.status ?? 'final', override_reason: '',
  };
  const set = (k: string, v: any) => setForm({ ...f, [k]: v });
  const save = async () => {
    setError(null);
    try { await payrollApi.put(`periods/${periodId}/attendance/${row.employee.id}`, f); toast.success('Attendance saved'); onSaved(); }
    catch (e) { setError(e); }
  };
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3"><Avatar name={row.employee.name} />
          <div><div className="flex items-center gap-2 font-semibold text-slate-900">{row.employee.name} <Badge status={row.employee.status} /></div>
            <div className="text-sm text-slate-500">{row.employee.employee_code} | {row.employee.department} | {row.employee.employment_type?.replace('_', '-')}</div></div></div>
        <button onClick={onClose} className="text-slate-400"><Icons.x className="h-4 w-4" /></button>
      </div>
      <div className="mb-3 text-sm font-semibold text-slate-800">Attendance Summary</div>
      <ErrorBanner error={error} />
      <div className="grid grid-cols-2 gap-3">
        {[['working_days', 'Total Days'], ['payable_days', 'Payable Days'], ['present_days', 'Present Days'], ['lop_days', 'LOP Days'],
          ['paid_leave_days', 'Paid Leave'], ['unpaid_leave_days', 'Unpaid Leave'], ['ot_hours', 'OT Hours'], ['pending_leave_requests', 'Pending leave requests']].map(([k, l]) => (
          <Field key={k} label={l}><Input type="number" step="0.5" value={f[k]} disabled={locked} onChange={(e) => set(k, e.target.value)} /></Field>
        ))}
        <Field label="Status"><Select value={f.status} disabled={locked} onChange={(e) => set('status', e.target.value)} options={[{ value: 'final', label: 'Final' }, { value: 'pending', label: 'Pending' }]} /></Field>
      </div>
      <Field label="Reason for manual change" className="mt-3"><Textarea value={f.override_reason} disabled={locked} onChange={(e) => set('override_reason', e.target.value)} /></Field>
      {a.source && <div className="mt-2 text-xs text-slate-500">Source: {a.source.replace('_', ' ')}{a.snapshot ? ' · in snapshot' : ''}</div>}
      {!locked && <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>}
    </Card>
  );
}

function ImportModal({ open, onClose, periodId, onDone }: { open: boolean; onClose: () => void; periodId: string; onDone: () => void }) {
  const [text, setText] = useState('employee_code,working_days,payable_days,lop_days,present_days,paid_leave_days,unpaid_leave_days,ot_hours,status\n');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Import finalized attendance summary" size="max-w-2xl"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true);
        try { const r = await payrollApi.post<any>(`periods/${periodId}/attendance/import`, { csv: text }, { 'Idempotency-Key': idempotencyKey() }); setResult(r.data); if (!r.data.errors.length) { toast.success(`${r.data.imported} rows imported`); onDone(); } }
        catch (e) { toast.error(e); } finally { setBusy(false); }
      }}>Import</Button></>}>
      <p className="mb-2 text-sm text-slate-600">Paste CSV exported from the attendance system, or choose a file.</p>
      <input type="file" accept=".csv" className="mb-2 text-sm" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setText(await file.text()); }} />
      <Textarea rows={10} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      {result?.errors?.length > 0 && <ErrorBanner error={{ message: `${result.imported} imported, ${result.errors.length} row(s) failed`, fieldMessages: result.errors.map((x: any) => `Row ${x.row}: ${x.error}`) }} />}
    </Modal>
  );
}
