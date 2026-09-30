/**
 * Browser-side Help (support ticketing) API client. Talks only to the local
 * `/api/help/*` route handlers (never the Django backend directly); those
 * proxy to Django and carry the httpOnly session cookie. Mirrors the
 * conventions in `lib/api/leave.ts`.
 */

export type TicketStatus = 'New' | 'In progress' | 'Waiting' | 'Resolved' | 'Closed' | 'Reopened';
export type TicketPriority = 'Low' | 'Medium' | 'High';
export type TicketCategory = 'IT & Access' | 'Facilities' | 'Food' | 'Cab' | 'Finance & Admin' | 'HR' | 'Others';
export type TicketActivityType = 'created' | 'status-updated' | 'reopened' | 'edited' | 'assigned';

export const TICKET_CATEGORIES: TicketCategory[] = [
  'IT & Access',
  'Facilities',
  'Food',
  'Cab',
  'Finance & Admin',
  'HR',
  'Others',
];

export const TICKET_PRIORITIES: TicketPriority[] = ['Low', 'Medium', 'High'];

export const TICKET_STATUSES: TicketStatus[] = ['New', 'In progress', 'Waiting', 'Resolved', 'Closed', 'Reopened'];

export interface TicketActivity {
  id: string;
  event_type: TicketActivityType;
  previous_status: TicketStatus | null;
  new_status: TicketStatus | null;
  comment: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  employee_id: string;
  employee_name: string;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  admin_comment: string | null;
  reopen_count: number;
  escalation_level: number;
  created_at: string;
  updated_at: string;
  activities: TicketActivity[];
}

export interface CreateTicketInput {
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
}

export type EditTicketInput = Partial<CreateTicketInput>;

export interface TicketQueueFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
}

/** Who owns a category: each owner works its tickets, and new tickets
 * auto-assign to one of them (the least busy). An empty list means the category
 * has no owner yet (new tickets stay unassigned). */
export interface CategoryOwner {
  id: string;
  name: string;
}

export interface CategoryAssignment {
  category: TicketCategory;
  assignees: CategoryOwner[];
}

/** Which categories the caller should see in the Resolve Tickets rail -
 * every category for a full admin, or just the ones they're routed to own. */
export interface MyCategories {
  can_manage: boolean;
  categories: TicketCategory[];
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string | string[] };
}

/** Thrown for any non-2xx local API response; `message` is backend-friendly. */
export class HelpApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HelpApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/help${path}`, {
    credentials: 'include',
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
      : init?.headers,
  });

  let json: Envelope<T> | null = null;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    json = null;
  }

  if (!res.ok || !json?.success) {
    const raw = json?.error?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${res.status})`;

    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new HelpApiError(message, res.status);
  }

  return json.data as T;
}

function queryString(filters?: TicketQueueFilters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.category) params.set('category', filters.category);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const helpApi = {
  /** The caller's own tickets. */
  getMine: () => request<Ticket[]>('/tickets'),
  /** All tickets in the caller's scope - requires `help.manage`. */
  getQueue: (filters?: TicketQueueFilters) => request<Ticket[]>(`/tickets/queue${queryString(filters)}`),
  getOne: (id: string) => request<Ticket>(`/tickets/${id}`),
  create: (input: CreateTicketInput) =>
    request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: EditTicketInput) =>
    request<Ticket>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  reopen: (id: string, reason: string) =>
    request<Ticket>(`/tickets/${id}/reopen`, { method: 'PATCH', body: JSON.stringify({ reason }) }),
  /** Admin/helper action - requires `help.manage`. */
  updateStatus: (id: string, status: TicketStatus, comment?: string) =>
    request<Ticket>(`/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, comment }) }),
  /** Admin/helper action - requires `help.manage`. */
  assignToMe: (id: string) => request<Ticket>(`/tickets/${id}/assign`, { method: 'PATCH', body: JSON.stringify({}) }),
  /** Category routing config - requires `help.manage`. */
  getCategoryAssignments: () => request<CategoryAssignment[]>('/category-assignments'),
  /** Replaces the category's whole set of owners; an empty list clears it. */
  setCategoryAssignment: (category: TicketCategory, assigneeIds: string[]) =>
    request<CategoryAssignment>('/category-assignments', {
      method: 'PUT',
      body: JSON.stringify({ category, assignee_ids: assigneeIds }),
    }),
  /** Which categories the caller should see in the Resolve Tickets rail. */
  getMyCategories: () => request<MyCategories>('/my-categories'),
};

// ---- small formatting helpers shared by the help UI ----

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function statusPillClass(status: TicketStatus): string {
  switch (status) {
    case 'New':
      return 'bg-blue-100 text-blue-700';
    case 'In progress':
      return 'bg-amber-100 text-amber-700';
    case 'Waiting':
      return 'bg-purple-100 text-purple-700';
    case 'Resolved':
      return 'bg-emerald-100 text-emerald-700';
    case 'Closed':
      return 'bg-slate-100 text-slate-600';
    case 'Reopened':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function priorityPillClass(priority: TicketPriority): string {
  switch (priority) {
    case 'High':
      return 'bg-red-100 text-red-700';
    case 'Medium':
      return 'bg-amber-100 text-amber-700';
    case 'Low':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function activityLabel(activity: TicketActivity): string {
  switch (activity.event_type) {
    case 'created':
      return 'Ticket raised';
    case 'status-updated':
      return `Status changed${activity.previous_status ? ` from ${activity.previous_status}` : ''} to ${activity.new_status}`;
    case 'reopened':
      return 'Ticket reopened';
    case 'edited':
      return 'Ticket edited';
    case 'assigned':
      return 'Ticket assigned';
    default:
      return activity.event_type;
  }
}
