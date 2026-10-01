'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRequireAccess } from '@/lib/auth/useRequireAccess';
import { Badge, Button, Drawer, Notice, Pager, Select } from '@/components/admin/ui';
import {
  fmtDateTime,
  learningApi,
  type IdentityLink,
  type Page,
  type ReconciliationFinding,
  type ReconciliationRun,
  type SyncHealth,
  type SyncJob,
  type SyncJobDetail,
  type SyncStatus,
} from '@/lib/api/learning';

type Tab = 'health' | 'links' | 'jobs' | 'reconcile';

const TABS: { id: Tab; label: string }[] = [
  { id: 'health', label: 'Sync health' },
  { id: 'links', label: 'Learner links' },
  { id: 'jobs', label: 'Sync jobs' },
  { id: 'reconcile', label: 'Reconciliation' },
];

const SYNC_TONE: Record<SyncStatus, 'gray' | 'green' | 'red' | 'purple' | 'amber'> = {
  PENDING: 'gray',
  PROCESSING: 'purple',
  SUCCEEDED: 'green',
  RETRYING: 'amber',
  FAILED: 'red',
  RECONCILED: 'purple',
};

const LINK_TONE: Record<IdentityLink['status'], 'gray' | 'green' | 'red' | 'amber'> = {
  pending: 'amber',
  linked: 'green',
  deactivated: 'gray',
  conflict: 'red',
};

const FINDING_LABEL: Record<string, string> = {
  unlinked_active: 'Active employee without an LMS learner',
  exited_with_access: 'Exited employee still active in the LMS',
  link_conflict: 'Learner link conflict',
  missing_mapping: 'Missing department / designation',
  lms_unknown_employee: 'LMS learner with no HRMS employee',
  lms_learner_mismatch: 'Learner id differs between HRMS and LMS',
  lms_status_mismatch: 'Status differs between HRMS and LMS',
  stuck_sync: 'Failed sync event',
};

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export default function LmsIntegrationAdminPage() {
  const { hasAccess, isLoading } = useRequireAccess({ permission: 'lms.admin' });
  const [tab, setTab] = useState<Tab>('health');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (isLoading || !hasAccess) return null;

  return (
    <div className="min-h-screen bg-gray-50 font-['Inter']">
      <div className="p-4 sm:p-8 max-w-6xl space-y-4">
        <div className="flex gap-5 border-b border-gray-200 overflow-x-auto" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setNotice(null);
              }}
              className={`py-3 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.id ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {tab === 'health' && <HealthTab onJump={setTab} />}
        {tab === 'links' && <LinksTab notify={setNotice} />}
        {tab === 'jobs' && <JobsTab notify={setNotice} />}
        {tab === 'reconcile' && <ReconcileTab notify={setNotice} />}
      </div>
    </div>
  );
}

type Notify = (n: { tone: 'success' | 'error'; text: string } | null) => void;

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-xl font-bold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- health

function HealthTab({ onJump }: { onJump: (t: Tab) => void }) {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    learningApi.health().then(setHealth).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!health) return <div className="h-64 rounded-xl bg-gray-100 animate-pulse" aria-busy="true" />;

  const { config, outbound, inbound, links } = health;
  const configRows: [string, boolean, string][] = [
    ['Sync enabled', config.enabled, 'LMS_INTEGRATION_ENABLED'],
    ['HRMS → LMS delivery', config.lmsConfigured, 'LMS_BASE_URL + LMS_OUTBOUND_SECRET'],
    ['LMS → HRMS webhook', config.inboundConfigured, 'LMS_INBOUND_SECRET'],
    ['Single sign-on', config.ssoConfigured, 'LMS_SSO_SECRET + LMS_SSO_LAUNCH_URL'],
  ];
  const problems = outbound.FAILED + inbound.FAILED + links.conflict;

  return (
    <div className="space-y-4">
      {problems > 0 && (
        <Notice tone="warning">
          {outbound.FAILED + inbound.FAILED} failed event{outbound.FAILED + inbound.FAILED === 1 ? '' : 's'} and {links.conflict} link
          conflict{links.conflict === 1 ? '' : 's'} need attention.{' '}
          <button className="font-semibold underline" onClick={() => onJump('jobs')}>
            Review sync jobs
          </button>
        </Notice>
      )}

      <Card title="Configuration" action={<Button onClick={load}>Refresh</Button>}>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {configRows.map(([label, ok, env]) => (
            <li key={label} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
              <div>
                <p className="font-medium text-gray-800">{label}</p>
                <p className="text-xs text-gray-500 font-mono">{env}</p>
              </div>
              <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'Configured' : 'Not set'}</Badge>
            </li>
          ))}
        </ul>
        {config.baseUrl && <p className="text-xs text-gray-500 mt-3">LMS endpoint: {config.baseUrl}</p>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="HRMS → LMS">
          <dl className="grid grid-cols-3 gap-4">
            <Metric label="Pending" value={outbound.PENDING + outbound.PROCESSING} />
            <Metric label="Retrying" value={outbound.RETRYING} tone={outbound.RETRYING ? 'text-amber-600' : undefined} />
            <Metric label="Failed" value={outbound.FAILED} tone={outbound.FAILED ? 'text-red-600' : undefined} />
          </dl>
          <p className="text-xs text-gray-500 mt-3">
            Last delivered {fmtDateTime(outbound.lastSuccessAt)}
            {outbound.oldestPendingAt && ` · oldest waiting since ${fmtDateTime(outbound.oldestPendingAt)}`}
          </p>
        </Card>
        <Card title="LMS → HRMS">
          <dl className="grid grid-cols-3 gap-4">
            <Metric label="Applied" value={inbound.SUCCEEDED} />
            <Metric label="Failed" value={inbound.FAILED} tone={inbound.FAILED ? 'text-red-600' : undefined} />
            <Metric label="Processing" value={inbound.PROCESSING} />
          </dl>
          <p className="text-xs text-gray-500 mt-3">Last received {fmtDateTime(inbound.lastReceivedAt)}</p>
        </Card>
      </div>

      <Card title="Learner accounts">
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Metric label="Linked" value={links.linked} />
          <Metric label="Pending" value={links.pending} />
          <Metric label="Deactivated" value={links.deactivated} />
          <Metric label="Conflicts" value={links.conflict} tone={links.conflict ? 'text-red-600' : undefined} />
          <Metric label="Not provisioned" value={health.unlinkedActive} tone={health.unlinkedActive ? 'text-amber-600' : undefined} />
        </dl>
        <p className="text-xs text-gray-500 mt-3">
          {health.lastReconciliation
            ? `Last reconciliation ${fmtDateTime(health.lastReconciliation.startedAt)} · ${health.lastReconciliation.summary.total ?? 0} findings`
            : 'Reconciliation has not been run yet.'}{' '}
          <button className="font-semibold text-purple-700 hover:underline" onClick={() => onJump('reconcile')}>
            Open reconciliation
          </button>
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- links

function LinksTab({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<IdentityLink> | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [linking, setLinking] = useState<IdentityLink | null>(null);

  const load = useCallback(() => {
    learningApi
      .links({ status, q: q.trim(), page })
      .then(setData)
      .catch((e) => notify({ tone: 'error', text: errorMessage(e) }));
  }, [status, q, page, notify]);
  useEffect(load, [load]);

  const act = async (link: IdentityLink, fn: () => Promise<unknown>, success: string) => {
    setBusy(link.id);
    notify(null);
    try {
      await fn();
      notify({ tone: 'success', text: success });
      load();
    } catch (e) {
      notify({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Employee ↔ learner links">
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search employee code, name or learner id"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="sm:w-48"
          aria-label="Filter by link status"
        >
          <option value="">All statuses</option>
          <option value="linked">Linked</option>
          <option value="pending">Pending</option>
          <option value="conflict">Conflict</option>
          <option value="deactivated">Deactivated</option>
        </Select>
      </div>
      {!data ? (
        <div className="h-40 rounded-lg bg-gray-100 animate-pulse" />
      ) : data.results.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No learner links match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-semibold">Employee</th>
                <th className="py-2 pr-4 font-semibold">Learner id</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Last synced</th>
                <th className="py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.results.map((link) => (
                <tr key={link.id} className="align-top">
                  <td className="py-2 pr-4">
                    <Link href={`/org/${link.employee}`} className="font-medium text-purple-700 hover:underline">
                      {link.employeeName || link.employeeCode}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {link.employeeCode} · {link.employeeStatus}
                    </p>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-700">{link.learnerId ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={LINK_TONE[link.status]}>{link.status}</Badge>
                    {link.lastError && <p className="text-xs text-red-600 mt-1 max-w-xs">{link.lastError}</p>}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{fmtDateTime(link.lastSyncedAt)}</td>
                  <td className="py-2 text-right whitespace-nowrap space-x-1">
                    {link.status === 'conflict' ? (
                      <Button
                        disabled={busy === link.id}
                        onClick={() => act(link, () => learningApi.resetLink(link.employee), 'Link cleared. Provision or link it again.')}
                      >
                        Clear link
                      </Button>
                    ) : (
                      <Button
                        disabled={busy === link.id}
                        onClick={() => act(link, () => learningApi.resync(link.employee), 'Re-sync queued.')}
                      >
                        Re-sync
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setLinking(link)}>
                      Set learner
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {linking && (
        <LinkDrawer
          link={linking}
          onClose={() => setLinking(null)}
          onDone={(text) => {
            setLinking(null);
            notify({ tone: 'success', text });
            load();
          }}
        />
      )}
    </Card>
  );
}

function LinkDrawer({ link, onClose, onDone }: { link: IdentityLink; onClose: () => void; onDone: (text: string) => void }) {
  const [learnerId, setLearnerId] = useState(link.learnerId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await learningApi.link(link.employee, learnerId.trim());
      onDone(`${link.employeeName || link.employeeCode} linked to learner ${learnerId.trim()}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer title="Set LMS learner" subtitle={`${link.employeeName} · ${link.employeeCode}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Use this when the person already has an LMS account. The learner id must not be linked to anyone else — HRMS will refuse a
          duplicate.
        </p>
        <label className="block text-sm font-medium text-gray-700">
          LMS learner id
          <input
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
          />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2 justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving || !learnerId.trim()} onClick={save}>
            {saving ? 'Saving…' : 'Link learner'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- jobs

function JobsTab({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState('FAILED');
  const [direction, setDirection] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<SyncJob> | null>(null);
  const [detail, setDetail] = useState<SyncJobDetail | null>(null);

  const load = useCallback(() => {
    learningApi
      .syncJobs({ status, direction, page })
      .then(setData)
      .catch((e) => notify({ tone: 'error', text: errorMessage(e) }));
  }, [status, direction, page, notify]);
  useEffect(load, [load]);

  const retry = async (job: SyncJob) => {
    notify(null);
    try {
      await learningApi.retry(job.id);
      notify({ tone: 'success', text: `${job.eventType} queued for another attempt.` });
      setDetail(null);
      load();
    } catch (e) {
      notify({ tone: 'error', text: errorMessage(e) });
    }
  };

  const open = async (job: SyncJob) => {
    try {
      setDetail(await learningApi.syncJob(job.id));
    } catch (e) {
      notify({ tone: 'error', text: errorMessage(e) });
    }
  };

  return (
    <Card title="Sync jobs" action={<Button onClick={load}>Refresh</Button>}>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-48" aria-label="Filter by status">
          <option value="">All statuses</option>
          {(['FAILED', 'RETRYING', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'RECONCILED'] as SyncStatus[]).map((s) => (
            <option key={s} value={s}>
              {s[0] + s.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <Select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }} className="sm:w-48" aria-label="Filter by direction">
          <option value="">Both directions</option>
          <option value="outbound">HRMS → LMS</option>
          <option value="inbound">LMS → HRMS</option>
        </Select>
      </div>
      {!data ? (
        <div className="h-40 rounded-lg bg-gray-100 animate-pulse" />
      ) : data.results.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No sync jobs match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-4 font-semibold">Event</th>
                <th className="py-2 pr-4 font-semibold">Employee</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Attempts</th>
                <th className="py-2 pr-4 font-semibold">When</th>
                <th className="py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.results.map((job) => (
                <tr key={job.id} className="align-top">
                  <td className="py-2 pr-4">
                    <p className="font-medium text-gray-900">{job.eventType}</p>
                    <p className="text-xs text-gray-500">{job.direction === 'outbound' ? 'HRMS → LMS' : 'LMS → HRMS'}</p>
                  </td>
                  <td className="py-2 pr-4 text-gray-700">{job.employeeName || job.employeeCode || '—'}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={SYNC_TONE[job.status]}>{job.status}</Badge>
                    {job.lastError && <p className="text-xs text-red-600 mt-1 max-w-xs line-clamp-2">{job.lastError}</p>}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-gray-700">{job.attemptCount}</td>
                  <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{fmtDateTime(job.createdAt)}</td>
                  <td className="py-2 text-right whitespace-nowrap space-x-1">
                    <Button variant="ghost" onClick={() => open(job)}>
                      Details
                    </Button>
                    {job.direction === 'outbound' && (job.status === 'FAILED' || job.status === 'RETRYING') && (
                      <Button onClick={() => retry(job)}>Retry</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {detail && (
        <Drawer title={detail.eventType} subtitle={detail.eventId} onClose={() => setDetail(null)}>
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-gray-500">Status</dt>
                <dd><Badge tone={SYNC_TONE[detail.status]}>{detail.status}</Badge></dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Correlation id</dt>
                <dd className="font-mono text-xs break-all">{detail.correlationId}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Occurred</dt>
                <dd>{fmtDateTime(detail.occurredAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Next attempt</dt>
                <dd>{fmtDateTime(detail.nextAttemptAt)}</dd>
              </div>
            </dl>
            {detail.lastError && <Notice tone="error">{detail.lastError}</Notice>}
            {detail.deliveries.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">Delivery attempts</h4>
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {detail.deliveries.map((d) => (
                    <li key={d.attemptNo} className="px-3 py-2 flex justify-between gap-3">
                      <span>
                        #{d.attemptNo} · {fmtDateTime(d.attemptedAt)}
                        {d.error && <span className="block text-xs text-red-600">{d.error}</span>}
                      </span>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {d.httpStatus ?? 'no response'}
                        {d.durationMs != null && ` · ${d.durationMs} ms`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">Payload</h4>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-auto max-h-80">
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </div>
            {detail.direction === 'outbound' && (detail.status === 'FAILED' || detail.status === 'RETRYING') && (
              <Button variant="primary" onClick={() => retry(detail)}>
                Retry now
              </Button>
            )}
          </div>
        </Drawer>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- reconcile

function ReconcileTab({ notify }: { notify: Notify }) {
  const [runs, setRuns] = useState<ReconciliationRun[] | null>(null);
  const [current, setCurrent] = useState<ReconciliationRun | null>(null);
  const [provision, setProvision] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await learningApi.reconcileRuns();
      setRuns(page.results);
      if (page.results[0]) setCurrent(await learningApi.reconcileRun(page.results[0].id));
    } catch (e) {
      notify({ tone: 'error', text: errorMessage(e) });
    }
  }, [notify]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    setRunning(true);
    notify(null);
    try {
      const result = await learningApi.reconcile(provision);
      setCurrent(result);
      setRuns((prev) => [result, ...(prev ?? [])]);
      const actions = result.summary.actions;
      notify({
        tone: result.status === 'failed' ? 'error' : 'success',
        text:
          result.status === 'failed'
            ? `Reconciliation failed: ${result.error}`
            : `${result.summary.total ?? 0} findings.` +
              (provision && actions ? ` Queued ${actions.provisioned} provisioning and ${actions.deactivationsQueued} deactivation events.` : ''),
      });
    } catch (e) {
      notify({ tone: 'error', text: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  };

  const groups: Record<string, ReconciliationFinding[]> = {};
  for (const finding of current?.findings ?? []) (groups[finding.type] ??= []).push(finding);

  return (
    <div className="space-y-4">
      <Card title="Run reconciliation">
        <p className="text-sm text-gray-600 mb-3">
          Compares HRMS employees with LMS learners. Reports unlinked active employees, exited employees who still have access, duplicate
          or conflicting links and missing org mappings. It never changes learning records and never resolves a conflict by itself.
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={provision} onChange={(e) => setProvision(e.target.checked)} className="rounded" />
            Also queue the safe fixes (provision unlinked employees, deactivate exited ones)
          </label>
          <Button variant="primary" onClick={run} disabled={running} className="sm:ml-auto">
            {running ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </Card>

      {current && (
        <Card title={`Findings · ${fmtDateTime(current.startedAt)}`}>
          {current.summary.lms && current.summary.lms !== 'compared' && (
            <div className="mb-3">
              <Notice tone="warning">{current.summary.lms}</Notice>
            </div>
          )}
          {current.status === 'failed' ? (
            <Notice tone="error">{current.error}</Notice>
          ) : Object.keys(groups).length === 0 ? (
            <p className="text-sm text-green-700">Everything matches. No findings.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(groups).map(([type, items]) => (
                <details key={type} className="border border-gray-200 rounded-lg" open={items.length <= 5}>
                  <summary className="px-3 py-2 cursor-pointer flex items-center justify-between gap-3 text-sm font-semibold text-gray-900">
                    {FINDING_LABEL[type] ?? type}
                    <Badge tone={type === 'missing_mapping' ? 'amber' : 'red'}>{items.length}</Badge>
                  </summary>
                  <ul className="divide-y divide-gray-100 border-t border-gray-100 text-sm">
                    {items.slice(0, 200).map((f, i) => (
                      <li key={i} className="px-3 py-2 flex justify-between gap-3">
                        <span className="text-gray-800">
                          {f.employeeName || f.employeeCode || (f.eventType as string) || (f.learnerId ? `Learner ${f.learnerId}` : '—')}
                          {f.employeeCode && f.employeeName && <span className="text-gray-500"> · {f.employeeCode}</span>}
                        </span>
                        <span className="text-xs text-gray-500 text-right">
                          {f.missing?.join(', ') || (f.message as string) || (f.error as string) || (f.status as string) || ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </Card>
      )}

      {runs && runs.length > 1 && (
        <Card title="Previous runs">
          <ul className="divide-y divide-gray-100 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <button className="text-left text-purple-700 hover:underline" onClick={async () => setCurrent(await learningApi.reconcileRun(r.id))}>
                  {fmtDateTime(r.startedAt)} · {r.trigger}
                  {r.provision && ' · with fixes'}
                </button>
                <span className="text-gray-600">{r.status === 'failed' ? 'Failed' : `${r.summary.total ?? 0} findings`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
