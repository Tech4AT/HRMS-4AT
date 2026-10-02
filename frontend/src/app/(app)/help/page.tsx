'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/useAuth';
import {
  ClockIcon,
  CoffeeIcon,
  GridIcon,
  MapPinIcon,
  PackageIcon,
  PersonIcon,
  ReceiptIcon,
  SettingsIcon,
  WalletIcon,
} from '@/components/icons';
import { PeoplePicker, type PickerPerson } from '@/components/PeoplePicker';
import { TicketFormModal } from '@/components/help/TicketFormModal';
import { TicketDetailPanel } from '@/components/help/TicketDetailPanel';
import { getEmployeeDirectory, type DirectoryEmployee } from '@/lib/api/employees';
import {
  helpApi,
  HelpApiError,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  formatDateTime,
  priorityPillClass,
  statusPillClass,
  type CategoryAssignment,
  type CreateTicketInput,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/api/help';

type TabId = 'mine' | 'queue' | 'routing' | 'faqs';

/** Accent used for each category's chip in the Resolve Tickets rail - purely
 * visual grouping, doesn't change routing (unlike ESSL's per-category support
 * inboxes; here every `help.manage` holder still sees every category). */
const CATEGORY_ACCENT: Record<TicketCategory, string> = {
  'IT & Access': 'border-blue-500 text-blue-700 bg-blue-50',
  Facilities: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  Food: 'border-amber-500 text-amber-700 bg-amber-50',
  Cab: 'border-purple-500 text-purple-700 bg-purple-50',
  'Finance & Admin': 'border-pink-500 text-pink-700 bg-pink-50',
  HR: 'border-teal-500 text-teal-700 bg-teal-50',
  Others: 'border-slate-400 text-slate-700 bg-slate-100',
};

/** The "Choose a support area" picker on My Tickets - one card per category,
 * each opening "Raise a ticket" pre-filled with that category (ESSL's own
 * portal leads with this same picker before the ticket form). */
const CATEGORY_INFO: Record<
  TicketCategory,
  { description: string; icon: typeof SettingsIcon; iconBg: string; iconColor: string }
> = {
  'IT & Access': {
    description: 'Accounts, devices, software, VPN and network',
    icon: SettingsIcon,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  'Finance & Admin': {
    description: 'Expenses, reimbursements, payroll and administration',
    icon: WalletIcon,
    iconBg: 'bg-pink-50',
    iconColor: 'text-pink-600',
  },
  Facilities: {
    description: 'Office equipment, workspace and maintenance',
    icon: PackageIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  Food: {
    description: 'Meals, pantry supplies and catering requests',
    icon: CoffeeIcon,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  Cab: {
    description: 'Office travel, pickup, drop and cab-related issues',
    icon: MapPinIcon,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  HR: {
    description: 'Policies, onboarding, benefits and other HR matters',
    icon: PersonIcon,
    iconBg: 'bg-teal-50',
    iconColor: 'text-teal-600',
  },
  Others: {
    description: 'Requests that do not fit another support area',
    icon: GridIcon,
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
  },
};

const faqs = [
  {
    question: 'How do I reset my password?',
    answer: 'Click on your profile icon, select "Change Password", and follow the instructions to set a new password.',
  },
  {
    question: 'How do I view my payslips?',
    answer: 'Navigate to "My Finances" in the sidebar and select "My Pay" tab to view and download your payslips.',
  },
  {
    question: 'How do I apply for leave?',
    answer: 'Use the Leave Management section to request time off. Your manager will review and approve or reject your request.',
  },
  {
    question: 'How do I update my profile information?',
    answer: 'Go to "Me" in the navigation menu to view and update your personal profile information.',
  },
  {
    question: "Still stuck? Raise a ticket",
    answer: 'Use the "My Tickets" tab above to raise a ticket with IT, Facilities, Food, Cab, Finance & Admin, or HR support.',
  },
];

/* ============================== ticket table ============================== */

function TicketRow({
  ticket,
  mode,
  expanded,
  onToggle,
  onEdit,
  onReopen,
  onUpdateStatus,
  onAssignToMe,
  showRequester,
}: {
  ticket: Ticket;
  mode: 'employee' | 'admin';
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onReopen: (reason: string) => Promise<void>;
  onUpdateStatus: (status: TicketStatus, comment: string) => Promise<void>;
  onAssignToMe: () => Promise<void>;
  showRequester: boolean;
}) {
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-slate-50 transition-colors cursor-pointer">
        <td className="px-5 py-4 text-sm font-medium text-slate-900">
          {ticket.subject}
          <div className="text-xs text-slate-400 mt-0.5">{ticket.category}</div>
        </td>
        {showRequester ? (
          <td className="px-5 py-4 text-sm text-slate-700 whitespace-nowrap">{ticket.employee_name}</td>
        ) : null}
        {showRequester ? (
          <td className="px-5 py-4 text-sm whitespace-nowrap">
            {ticket.assigned_to_name ? (
              <span className="text-slate-700">{ticket.assigned_to_name}</span>
            ) : (
              <span className="text-slate-400 italic">Unassigned</span>
            )}
          </td>
        ) : null}
        <td className="px-5 py-4">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${priorityPillClass(ticket.priority)}`}>
            {ticket.priority}
          </span>
        </td>
        <td className="px-5 py-4">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusPillClass(ticket.status)}`}>
            {ticket.status}
          </span>
          {ticket.escalation_level > 0 ? (
            <div className="text-[10px] text-red-500 font-semibold mt-1">Escalation L{ticket.escalation_level}</div>
          ) : null}
        </td>
        <td className="px-5 py-4 text-sm text-slate-500 whitespace-nowrap">{formatDateTime(ticket.updated_at)}</td>
        <td className="px-5 py-4 text-slate-400">
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={showRequester ? 7 : 5} className="p-0">
            <TicketDetailPanel
              ticket={ticket}
              mode={mode}
              onEdit={onEdit}
              onReopen={onReopen}
              onUpdateStatus={onUpdateStatus}
              onAssignToMe={onAssignToMe}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/* ============================== stat cards ============================== */

function StatCard({
  label,
  value,
  subtitle,
  icon,
  iconBg,
  iconColor,
}: {
  label: string;
  value: number;
  subtitle: string;
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(15,23,42,0.04)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider truncate">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">{value}</div>
        <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
      </div>
    </div>
  );
}

/* ============================== page ============================== */

function HelpPageContent() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // `help.manage` = full admin: sees every category and is the only one who
  // can edit routing. Category ownership (below) is separate and data-driven
  // (CategoryAssignment) - it grants queue access scoped to just the owned
  // categories, with no RBAC permission needed.
  const canManage = hasPermission('help.manage');
  // null while undetermined (first load); true/false once the queue fetch in
  // `refresh` below resolves - the backend, not a client-side permission
  // list, is the source of truth for "can this user resolve tickets," since
  // that now depends on category-ownership data the frontend doesn't have
  // its own copy of.
  const [canResolve, setCanResolve] = useState<boolean | null>(null);

  const requestedTab = searchParams.get('tab') as TabId | null;
  const tab: TabId =
    requestedTab === 'queue' && canResolve
      ? 'queue'
      : requestedTab === 'routing' && canManage
        ? 'routing'
        : requestedTab === 'faqs'
          ? 'faqs'
          : 'mine';

  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  const [queueTickets, setQueueTickets] = useState<Ticket[]>([]);
  // Which categories to show as chips in the Resolve Tickets rail - all of
  // them for a full admin, or just the ones this user is routed to own.
  const [myCategories, setMyCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  // Set alongside `creating` when opened from a support-area card, so the
  // form preselects that category - undefined via the generic "Raise a new
  // ticket" button just falls back to the form's own default.
  const [createCategory, setCreateCategory] = useState<TicketCategory | undefined>(undefined);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<TicketStatus | 'All'>('All');
  const [filterPriority, setFilterPriority] = useState<TicketPriority | 'All'>('All');
  const [selectedCategory, setSelectedCategory] = useState<TicketCategory | 'All'>('All');

  // Category routing config (who a new ticket in each category auto-assigns
  // to) - only relevant to help.manage holders, loaded independently of the
  // ticket lists so a slow/failed employee-directory fetch never blocks them.
  const [routing, setRouting] = useState<CategoryAssignment[]>([]);
  const [routingEmployees, setRoutingEmployees] = useState<DirectoryEmployee[]>([]);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [routingSaving, setRoutingSaving] = useState<TicketCategory | null>(null);

  const refresh = useCallback(async () => {
    const mine = await helpApi.getMine();
    setMyTickets(mine);
    // Always attempt the queue - whether it's allowed depends on category
    // ownership data the frontend can't evaluate itself, so a 403 here is
    // the real answer to "can this user resolve tickets," not an error to
    // surface. Any other failure (network, 5xx, ...) still propagates to
    // the caller's loadError handling below.
    try {
      const [queue, myCats] = await Promise.all([helpApi.getQueue(), helpApi.getMyCategories()]);
      setQueueTickets(queue);
      setMyCategories(myCats.categories);
      setCanResolve(true);
    } catch (e) {
      if (e instanceof HelpApiError && e.status === 403) {
        setQueueTickets([]);
        setMyCategories([]);
        setCanResolve(false);
      } else {
        throw e;
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    refresh()
      .catch((e) => {
        if (active) setLoadError(e instanceof HelpApiError ? e.message : 'Failed to load tickets');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    setRoutingLoading(true);
    setRoutingError(null);
    Promise.all([helpApi.getCategoryAssignments(), getEmployeeDirectory()])
      .then(([assignments, employees]) => {
        if (!active) return;
        setRouting(assignments);
        setRoutingEmployees(employees);
      })
      .catch((e) => {
        if (active) setRoutingError(e instanceof Error ? e.message : 'Failed to load category routing');
      })
      .finally(() => {
        if (active) setRoutingLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canManage]);

  const routingOptions = useMemo<PickerPerson[]>(
    () => routingEmployees.map((e) => ({ id: e.id, name: e.name, hint: e.department })),
    [routingEmployees],
  );

  const handleRoutingChange = async (category: TicketCategory, assigneeIds: string[]) => {
    setRoutingSaving(category);
    setRoutingError(null);
    try {
      const updated = await helpApi.setCategoryAssignment(category, assigneeIds);
      setRouting((rows) => rows.map((r) => (r.category === category ? updated : r)));
    } catch (e) {
      setRoutingError(e instanceof Error ? e.message : 'Could not update routing');
    } finally {
      setRoutingSaving(null);
    }
  };

  // Open = not yet Closed - what the rail's counts and default view are
  // triaging; Closed tickets stay reachable via the "All statuses" filter.
  const openCategoryCounts = useMemo(() => {
    const counts = new Map<TicketCategory, number>();
    queueTickets.forEach((t) => {
      if (t.status === 'Closed') return;
      counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    });
    return counts;
  }, [queueTickets]);
  const totalOpen = useMemo(() => queueTickets.filter((t) => t.status !== 'Closed').length, [queueTickets]);

  const myOpenCount = useMemo(() => myTickets.filter((t) => t.status !== 'Closed').length, [myTickets]);
  const myAwaitingReviewCount = useMemo(
    () => myTickets.filter((t) => t.status === 'Resolved').length,
    [myTickets],
  );

  // No employee id is exposed on the auth `user` object (only the User pk),
  // so "assigned to me" is matched by display name against the ticket's
  // assigned_to_name - good enough for a dashboard count.
  const myDisplayName = user ? `${user.firstName} ${user.lastName}`.trim() : '';
  const waitingForMeCount = useMemo(
    () => queueTickets.filter((t) => t.status === 'Waiting' && t.assigned_to_name === myDisplayName).length,
    [queueTickets, myDisplayName],
  );

  const filteredQueue = useMemo(
    () =>
      queueTickets.filter((t) => {
        if (selectedCategory !== 'All' && t.category !== selectedCategory) return false;
        if (filterStatus !== 'All' && t.status !== filterStatus) return false;
        if (filterPriority !== 'All' && t.priority !== filterPriority) return false;
        return true;
      }),
    [queueTickets, filterStatus, filterPriority, selectedCategory],
  );

  const applyTicket = (updated: Ticket) => {
    setMyTickets((rows) => rows.map((t) => (t.id === updated.id ? updated : t)));
    setQueueTickets((rows) => rows.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleCreate = async (input: CreateTicketInput) => {
    const created = await helpApi.create(input);
    setMyTickets((rows) => [created, ...rows]);
    setCreating(false);
    setCreateCategory(undefined);
    setActionMessage('Ticket raised — our support team will pick it up shortly.');
  };

  const handleEdit = async (input: CreateTicketInput) => {
    if (!editingTicket) return;
    const updated = await helpApi.update(editingTicket.id, input);
    applyTicket(updated);
    setEditingTicket(null);
  };

  const handleReopen = async (ticket: Ticket, reason: string) => {
    const updated = await helpApi.reopen(ticket.id, reason);
    applyTicket(updated);
  };

  const handleUpdateStatus = async (ticket: Ticket, status: TicketStatus, comment: string) => {
    const updated = await helpApi.updateStatus(ticket.id, status, comment || undefined);
    applyTicket(updated);
  };

  const handleAssignToMe = async (ticket: Ticket) => {
    const updated = await helpApi.assignToMe(ticket.id);
    applyTicket(updated);
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'mine', label: 'My Tickets' },
    ...(canResolve ? [{ id: 'queue' as TabId, label: 'Resolve Tickets' }] : []),
    ...(canManage ? [{ id: 'routing' as TabId, label: 'Category Routing' }] : []),
    { id: 'faqs', label: 'FAQs' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter']">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-8">
        <div className="flex gap-5 overflow-x-auto scrollbar-hide" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => router.replace(`/help?tab=${t.id}`)}
              className={`px-1 py-3 border-b-2 font-semibold whitespace-nowrap transition-colors ${
                tab === t.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-8 space-y-4">
        {actionMessage ? (
          <div className="text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {actionMessage}
          </div>
        ) : null}
        {loadError ? (
          <div className="text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {loadError}
          </div>
        ) : null}

        {tab === 'faqs' ? (
          <div className="max-w-3xl space-y-4">
            {faqs.map((faq, idx) => (
              <details key={idx} className="bg-white rounded-2xl border border-slate-200 p-5 group">
                <summary className="flex items-center justify-between cursor-pointer font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
                  <span>{faq.question}</span>
                  <svg className="w-5 h-5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </summary>
                <p className="text-slate-600 mt-4 text-sm leading-relaxed">{faq.answer}</p>
              </details>
            ))}
          </div>
        ) : null}

        {tab === 'mine' ? (
          <div className="space-y-6">
            {/* Hero - fit to the app's light card language (no gradients/dark
                panels elsewhere in this codebase), but keeps the reference
                design's heading + primary action + support-area picker IA. */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">Employee support</span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">How can we help today?</h2>
              <p className="text-sm text-slate-500 mt-2 max-w-xl">
                Report an issue or request help from the right internal team. You can follow every update from this
                workspace.
              </p>
              <button
                onClick={() => {
                  setCreateCategory(undefined);
                  setCreating(true);
                }}
                className="mt-5 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <span className="text-base leading-none">+</span> Raise a new ticket
              </button>
            </div>

            <div>
              <h2 className="text-base font-bold text-slate-900">Choose a support area</h2>
              <p className="text-xs text-slate-500 mt-0.5">We'll route your request to the right team.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
                {TICKET_CATEGORIES.map((c) => {
                  const info = CATEGORY_INFO[c];
                  const Icon = info.icon;
                  return (
                    <button
                      key={c}
                      onClick={() => {
                        setCreateCategory(c);
                        setCreating(true);
                      }}
                      className="text-left bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-md hover:border-indigo-200 transition-all p-4"
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${info.iconBg} ${info.iconColor}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="mt-3 text-sm font-bold text-slate-900">{c}</div>
                      <div className="text-xs text-slate-500 mt-1">{info.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                label="Open tickets"
                value={myOpenCount}
                subtitle="Across your tickets"
                icon={<ReceiptIcon className="w-4.5 h-4.5" />}
                iconBg="bg-indigo-50"
                iconColor="text-indigo-600"
              />
              <StatCard
                label="Awaiting your review"
                value={myAwaitingReviewCount}
                subtitle="Reopen if it's not fixed yet"
                icon={<ClockIcon className="w-4.5 h-4.5" />}
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
              />
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div className="px-5 py-5">
                <h2 className="text-base font-bold text-slate-900">My Tickets</h2>
                <p className="text-xs text-slate-500 mt-0.5">Requests you've raised, and their current status.</p>
              </div>
              {loading ? (
                <p className="text-sm text-slate-500 px-5 pb-5">Loading…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-y border-slate-200">
                      <tr>
                        {['Subject', 'Priority', 'Status', 'Updated', ''].map((h) => (
                          <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {myTickets.map((t) => (
                        <TicketRow
                          key={t.id}
                          ticket={t}
                          mode="employee"
                          showRequester={false}
                          expanded={expandedId === t.id}
                          onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
                          onEdit={() => setEditingTicket(t)}
                          onReopen={(reason) => handleReopen(t, reason)}
                          onUpdateStatus={(status, comment) => handleUpdateStatus(t, status, comment)}
                          onAssignToMe={() => handleAssignToMe(t)}
                        />
                      ))}
                      {myTickets.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">
                            No tickets yet — raise one if something needs support's attention.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'queue' && canResolve ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Resolve Tickets</h2>
              <p className="text-xs text-slate-500 mt-0.5">Pick an issue type to work through - counts are open tickets waiting on your team.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                label="Open tickets"
                value={totalOpen}
                subtitle={canManage ? 'Across all support teams' : 'Across your assigned categories'}
                icon={<ReceiptIcon className="w-4.5 h-4.5" />}
                iconBg="bg-indigo-50"
                iconColor="text-indigo-600"
              />
              <StatCard
                label="Waiting for you"
                value={waitingForMeCount}
                subtitle="Additional information needed"
                icon={<ClockIcon className="w-4.5 h-4.5" />}
                iconBg="bg-amber-50"
                iconColor="text-amber-600"
              />
            </div>

            {/* Category rail - the primary way to triage: pick the kind of
                issue you're addressing rather than scrolling one mixed list. */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory('All')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                  selectedCategory === 'All' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                All issues
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/70">{totalOpen}</span>
              </button>
              {myCategories.map((c) => {
                const count = openCategoryCounts.get(c) ?? 0;
                const active = selectedCategory === c;
                return (
                  <button
                    key={c}
                    onClick={() => setSelectedCategory(c)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                      active ? CATEGORY_ACCENT[c] : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {c}
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/70' : 'bg-slate-100'}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex flex-wrap gap-3 px-5 py-4 border-b border-slate-100">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as TicketStatus | 'All')}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                >
                  <option value="All">All statuses</option>
                  {TICKET_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value as TicketPriority | 'All')}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                >
                  <option value="All">All priorities</option>
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {loading ? (
                <p className="text-sm text-slate-500 px-5 py-5">Loading…</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-y border-slate-200">
                      <tr>
                        {['Subject', 'Raised by', 'Assigned to', 'Priority', 'Status', 'Updated', ''].map((h) => (
                          <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredQueue.map((t) => (
                        <TicketRow
                          key={t.id}
                          ticket={t}
                          mode="admin"
                          showRequester
                          expanded={expandedId === t.id}
                          onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
                          onEdit={() => {}}
                          onReopen={async () => {}}
                          onUpdateStatus={(status, comment) => handleUpdateStatus(t, status, comment)}
                          onAssignToMe={() => handleAssignToMe(t)}
                        />
                      ))}
                      {filteredQueue.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">
                            No tickets match these filters.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'routing' && canManage ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Category Routing</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                A category can have several owners. Each owner gets the Resolve Tickets tab, scoped to just that
                category, and is notified of its tickets. New tickets auto-assign to the owner with the fewest open
                tickets - admin-only.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
              {routingError ? (
                <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{routingError}</p>
              ) : null}
              {routingLoading ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : (
                routing.map((row) => (
                  <div key={row.category} className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-3 py-1">
                    <span className="text-sm font-medium text-slate-700 sm:pt-2">{row.category}</span>
                    <PeoplePicker
                      ariaLabel={`Owners of ${row.category}`}
                      options={routingOptions}
                      selected={row.assignees.map((a) => ({ id: a.id, name: a.name }))}
                      busy={routingSaving === row.category}
                      placeholder="Unassigned: search to add"
                      onChange={(ids) => handleRoutingChange(row.category, ids)}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      {creating ? (
        <TicketFormModal
          mode="create"
          initialCategory={createCategory}
          onClose={() => {
            setCreating(false);
            setCreateCategory(undefined);
          }}
          onSubmit={handleCreate}
        />
      ) : null}
      {editingTicket ? (
        <TicketFormModal mode="edit" ticket={editingTicket} onClose={() => setEditingTicket(null)} onSubmit={handleEdit} />
      ) : null}
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={null}>
      <HelpPageContent />
    </Suspense>
  );
}
