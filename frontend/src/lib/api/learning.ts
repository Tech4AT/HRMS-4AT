/** LMS integration API — `/api/integrations/lms/*` proxies to Django
 * `/integrations/lms/*` (backend/lms_integration, docs/LMS-INTEGRATION.md).
 * The learning data itself lives in the LMS; these are HRMS's read
 * projections of it plus the integration admin endpoints. */

export type LinkStatus = 'not_linked' | 'pending' | 'linked' | 'deactivated' | 'conflict';
export type CourseStatus = 'assigned' | 'in_progress' | 'completed';
export type CertificationStatus = 'active' | 'expiring' | 'expired' | 'revoked';
export type SyncStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'RETRYING' | 'FAILED' | 'RECONCILED';

export interface LearningSummary {
  employeeId: number;
  link: { status: LinkStatus; learnerId: string | null; linkedAt: string | null; lastSyncedAt: string | null };
  courses: { assigned: number; inProgress: number; completed: number; overdue: number; completionRate: number };
  mandatory: { total: number; completed: number; outstanding: number; progress: number };
  learningPaths: { pathId: string; name: string; total: number; completed: number; progress: number }[];
  assessments: { taken: number; passed: number };
  certifications: { total: number; active: number; expiring: number; expired: number };
  skills: number;
}

export interface Course {
  id: number;
  courseId: string;
  title: string;
  category: string;
  pathId: string;
  pathName: string;
  mandatory: boolean;
  status: CourseStatus;
  progress: number;
  assignedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  score: string | null;
}

export interface Assessment {
  id: number;
  assessmentId: string;
  title: string;
  courseId: string;
  status: string;
  score: string | null;
  maxScore: string | null;
  completedAt: string | null;
}

export interface Certification {
  id: number;
  certificationId: string;
  name: string;
  issuedAt: string | null;
  expiresAt: string | null;
  status: CertificationStatus;
  credentialUrl: string;
}

export interface Skill {
  id: number;
  skillId: string;
  name: string;
  proficiency: string;
  proficiencyScore: string | null;
  evidenceRefs: string[];
}

export interface ComplianceOverview {
  headcount: number;
  linkedLearners: number;
  courses: {
    assigned: number;
    completed: number;
    mandatoryTotal: number;
    mandatoryCompleted: number;
    overdue: number;
    completionRate: number;
  };
  mandatoryCompliance: number;
  byDepartment: { department: string; assigned: number; completed: number; completionRate: number }[];
  expiringCertifications: {
    employeeId: number;
    employeeCode: string;
    employeeName: string;
    department: string | null;
    certificationId: string;
    name: string;
    expiresAt: string;
    status: CertificationStatus;
  }[];
}

type StatusCounts = Record<SyncStatus, number>;

export interface SyncHealth {
  config: {
    enabled: boolean;
    lmsConfigured: boolean;
    inboundConfigured: boolean;
    ssoConfigured: boolean;
    baseUrl: string | null;
  };
  outbound: StatusCounts & { lastSuccessAt: string | null; oldestPendingAt: string | null };
  inbound: StatusCounts & { lastReceivedAt: string | null };
  links: Record<Exclude<LinkStatus, 'not_linked'>, number>;
  unlinkedActive: number;
  lastReconciliation: ReconciliationRun | null;
}

export interface IdentityLink {
  id: number;
  employee: number;
  employeeCode: string;
  employeeName: string;
  employeeStatus: string;
  learnerId: string | null;
  status: Exclude<LinkStatus, 'not_linked'>;
  linkedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string;
}

export interface SyncJob {
  id: number;
  eventId: string;
  eventType: string;
  direction: 'outbound' | 'inbound';
  correlationId: string;
  employee: number | null;
  employeeCode: string | null;
  employeeName: string | null;
  status: SyncStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string;
  occurredAt: string;
  processedAt: string | null;
  createdAt: string;
}

export interface SyncJobDetail extends SyncJob {
  payload: Record<string, unknown>;
  deliveries: {
    attemptNo: number;
    target: string;
    succeeded: boolean;
    httpStatus: number | null;
    error: string;
    durationMs: number | null;
    attemptedAt: string;
  }[];
}

export interface ReconciliationFinding {
  type: string;
  employeeId?: number | string;
  employeeCode?: string;
  employeeName?: string;
  status?: string;
  learnerId?: string;
  message?: string;
  missing?: string[];
  eventId?: string;
  eventType?: string;
  error?: string;
  [key: string]: unknown;
}

export interface ReconciliationRun {
  id: number;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  provision: boolean;
  summary: {
    counts?: Record<string, number>;
    total?: number;
    actions?: { provisioned: number; deactivationsQueued: number };
    lms?: string;
  };
  error: string;
  startedAt: string;
  finishedAt: string | null;
  findings?: ReconciliationFinding[];
}

export interface Page<T> {
  results: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SsoLaunch {
  launchUrl: string;
  method: 'POST';
  field: string;
  token: string;
  expiresAt: string;
}

export class LearningApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'LearningApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/integrations/lms${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const raw = json?.error?.message ?? json?.error?.fields;
    const message =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object'
          ? Object.values(raw).flat().join(' ')
          : `Request failed (${res.status})`;
    throw new LearningApiError(message, res.status, json?.error?.code);
  }
  return json.data as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

function query(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}

/** `employeeId` is an HRMS employee id or `'me'`. */
export const learningApi = {
  summary: (employeeId: string | number) => request<LearningSummary>(`/learners/${employeeId}/summary`),
  courses: (employeeId: string | number) => request<Course[]>(`/learners/${employeeId}/courses`),
  assessments: (employeeId: string | number) => request<Assessment[]>(`/learners/${employeeId}/assessments`),
  certifications: (employeeId: string | number) =>
    request<Certification[]>(`/learners/${employeeId}/certifications`),
  skills: (employeeId: string | number) => request<Skill[]>(`/learners/${employeeId}/skills`),
  compliance: () => request<ComplianceOverview>('/compliance'),
  launch: (target?: string) => post<SsoLaunch>('/sso/launch', target ? { target } : {}),

  // Integration admin (lms.admin)
  health: () => request<SyncHealth>('/health'),
  links: (params: { status?: string; q?: string; page?: number } = {}) =>
    request<Page<IdentityLink>>(`/learners${query(params)}`),
  link: (employeeId: number, learnerId?: string) =>
    post<{ link: IdentityLink; eventId: string | null; alreadyLinked?: boolean }>('/learners', {
      employeeId,
      ...(learnerId ? { learnerId } : {}),
    }),
  resync: (employeeId: number) =>
    request<{ eventId: string; eventType: string }>(`/learners/${employeeId}`, { method: 'PATCH', body: '{}' }),
  resetLink: (employeeId: number) => post<IdentityLink>(`/learners/${employeeId}/reset-link`),
  syncJobs: (params: { status?: string; direction?: string; eventType?: string; page?: number } = {}) =>
    request<Page<SyncJob>>(
      `/sync-jobs${query({ status: params.status, direction: params.direction, event_type: params.eventType, page: params.page })}`,
    ),
  syncJob: (id: number | string) => request<SyncJobDetail>(`/sync-jobs/${id}`),
  retry: (id: number) => post<SyncJob>(`/sync-jobs/${id}/retry`),
  reconcileRuns: () => request<Page<ReconciliationRun>>('/reconcile'),
  reconcileRun: (id: number) => request<ReconciliationRun>(`/reconcile/${id}`),
  reconcile: (provision: boolean) => post<ReconciliationRun>('/reconcile', { provision }),
};

/** Open the LMS in a new tab through the SSO hand-off: the short-lived token
 * is form-POSTed (never put in a URL, so it stays out of history and logs). */
export async function openLms(target?: string) {
  const launch = await learningApi.launch(target);
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = launch.launchUrl;
  form.target = '_blank';
  form.rel = 'noopener';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = launch.field;
  input.value = launch.token;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  assigned: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const CERT_STATUS_LABEL: Record<CertificationStatus, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  revoked: 'Revoked',
};

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
