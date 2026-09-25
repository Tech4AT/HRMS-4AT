'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/useAuth';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ProfileDropdown } from '@/components/ProfileDropdown';
import { NotificationsDropdown } from '@/components/NotificationsDropdown';
import {
  HomeIcon,
  InboxIcon,
  TeamIcon,
  WalletIcon,
  TimerIcon,
  CalendarCheckIcon,
  TrendingUpIcon,
  MessageCircleIcon,
  GlobeIcon,
  GridIcon,
  SettingsIcon,
  HelpIcon,
  MenuIcon,
  XIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  IdCardIcon,
} from '@/components/icons';

type RequiredRole = 'employee' | 'admin' | 'superadmin';

const roleLabels: Record<RequiredRole, string> = {
  employee: 'Employee',
  admin: 'Manager',
  superadmin: 'HR Administrator',
};

function roleLabel(role?: string) {
  return roleLabels[role as RequiredRole] || 'Employee';
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  roles: RequiredRole[];
  /** Also require {kind:'org'} scope, e.g. an org-wide employee directory a
   * team-scoped Admin shouldn't see even though their role otherwise would
   * grant access — see useRequireAccess for the matching route guard. */
  requireOrgScope?: boolean;
  /** Only show for users holding this backend permission code (e.g. 'roles.manage'). */
  requirePermission?: string;
  /** Only show for users holding at least one of these permission codes. */
  requireAnyPermission?: string[];
  badge?: number;
  children?: NavChild[];
}

/** A submenu link. Optionally gated by the same access rules as a top-level
 * item (`roles`/`requireOrgScope`/`requirePermission`/`requireAnyPermission`),
 * so one menu can hold links that only some roles/permissions can see (e.g.
 * Organisation's "All Employees" is superadmin+org-scope only). Separately,
 * `matchPrefixes` extends which URLs count as "on this child" for
 * tab-highlighting - e.g. My Attendance also owns /leave and /me/attendance. */
interface NavChild {
  label: string;
  href: string;
  roles?: RequiredRole[];
  requireOrgScope?: boolean;
  requirePermission?: string;
  requireAnyPermission?: string[];
  matchPrefixes?: string[];
}

/** Is `pathname`(+`search`) the target of a nav child's `href`? Handles both
 * plain-path children (Settings -> /attendance/settings) and query-tab
 * children (Summary -> /payslips?tab=summary), where `usePathname()` alone
 * can't tell tabs on the same path apart. `isFirst` lets the first child of a
 * query-tab group match when no query param is present yet (pages default to
 * their first tab), so the bar doesn't render with nothing highlighted. */
function isChildActive(
  child: { href: string; matchPrefixes?: string[] },
  pathname: string,
  searchParams: URLSearchParams,
  isFirst: boolean,
): boolean {
  if (child.matchPrefixes) {
    return child.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  const [path, query] = child.href.split('?');
  if (pathname !== path) return false;
  if (!query) return true;
  const params = new URLSearchParams(query);
  for (const [key, value] of params.entries()) {
    const actual = searchParams.get(key);
    if (actual === value) continue;
    if (isFirst && !actual) continue;
    return false;
  }
  return true;
}

/** Which of a section's children (if any) owns the current URL - path-only
 * children (Settings, Payroll Setup, ...) use longest-matching-prefix so a
 * more specific child wins over its broader sibling; query-tab children
 * (Summary/My Pay/..., all sharing one path) compare query params instead,
 * since `usePathname()` can't tell them apart. A section never mixes both
 * kinds, so checking which kind is present up front is enough. */
function getActiveChild<T extends { href: string; matchPrefixes?: string[] }>(
  children: T[],
  pathname: string,
  searchParams: URLSearchParams,
): T | undefined {
  const queryChildren = children.filter((c) => c.href.includes('?'));
  if (queryChildren.length) {
    return queryChildren.find((c, i) => isChildActive(c, pathname, searchParams, i === 0));
  }
  const candidates = children.flatMap((c) => (c.matchPrefixes ?? [c.href]).map((p) => ({ child: c, p })));
  return candidates
    .filter(({ p }) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.p.length - a.p.length)[0]?.child;
}

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: HomeIcon, href: '/', roles: ['admin', 'employee', 'superadmin'] },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon, href: '/inbox', badge: 5, roles: ['admin', 'employee', 'superadmin'] },
  {
    // Approvals lives under Attendance, not as its own top-level item - it's
    // a review surface for WFH/Regularisation/Leave/Penalisation, each its
    // own in-page tab (approvals/page.tsx's own SectionTabs), not a
    // cross-module inbox. Employees who can't approve anything never see it
    // (that page redirects them away) - self-service raise/cancel of their
    // own requests lives on the Leave/My Attendance pages instead, not here.
    id: 'attendance',
    label: 'Attendance',
    icon: CalendarCheckIcon,
    href: '/attendance',
    roles: ['admin', 'employee', 'superadmin'],
    children: [
      {
        label: 'Dashboard',
        href: '/attendance/dashboard',
        requireAnyPermission: ['leave.approve', 'attendance.approve', 'scope.all'],
      },
      { label: 'My Attendance', href: '/attendance', matchPrefixes: ['/attendance', '/me/attendance', '/leave'] },
      {
        label: 'Approvals',
        href: '/approvals',
        requireAnyPermission: ['leave.approve', 'attendance.approve'],
      },
      { label: 'Settings', href: '/attendance/settings', requireAnyPermission: ['attendance.settings.manage', 'calendar.manage'] },
    ],
  },
  { id: 'timesheet', label: 'Timesheet', icon: TimerIcon, href: '/timesheet', roles: ['admin', 'employee', 'superadmin'] },
  {
    id: 'finances',
    label: 'My Finances',
    icon: WalletIcon,
    href: '/payslips',
    roles: ['admin', 'employee', 'superadmin'],
    children: [
      { label: 'Summary', href: '/payslips?tab=summary' },
      { label: 'My Pay', href: '/payslips?tab=pay' },
      { label: 'Manage Tax', href: '/payslips?tab=tax' },
    ],
  },
  {
    id: 'perf',
    label: 'Performance',
    icon: TrendingUpIcon,
    href: '/performance',
    roles: ['admin', 'employee', 'superadmin'],
  },
  { id: 'team', label: 'My Team', icon: TeamIcon, href: '/team', roles: ['admin', 'employee', 'superadmin'] },
  {
    // One Organisation menu; which sub-links show depends on the viewer's
    // access (directory/chart/documents for everyone, manage + all-employees
    // only for those with the rights).
    id: 'org',
    label: 'Organisation',
    icon: GlobeIcon,
    href: '/org',
    roles: ['admin', 'employee', 'superadmin'],
    children: [
      { label: 'Employee Directory', href: '/org?tab=directory' },
      { label: 'Organisation Chart', href: '/org?tab=chart' },
      { label: 'Documents', href: '/org?tab=documents' },
      {
        label: 'Manage Structure',
        href: '/manage-org',
        requireAnyPermission: ['employees.write', 'org.manage'],
      },
      { label: 'All Employees', href: '/employees', roles: ['superadmin'], requireOrgScope: true },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    icon: WalletIcon,
    href: '/payroll-inputs',
    roles: ['admin', 'employee', 'superadmin'],
    requireOrgScope: true,
    requireAnyPermission: ['payroll.write', 'payroll.manage'],
    children: [
      { label: 'Payroll Inputs', href: '/payroll-inputs' },
      { label: 'Payroll Setup', href: '/payroll-setup' },
    ],
  },
  { id: 'admin', label: 'Access control', icon: IdCardIcon, href: '/admin', roles: ['admin', 'employee', 'superadmin'], requirePermission: 'roles.manage' },
  { id: 'engage', label: 'Engage', icon: MessageCircleIcon, href: '/engage', roles: ['admin', 'employee', 'superadmin'] },
  { id: 'apps', label: 'Apps', icon: GridIcon, href: '/apps', roles: ['admin', 'employee', 'superadmin'] },
];

const COLLAPSE_STORAGE_KEY = 'hrms-sidebar-collapsed';

const pageTitles: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Home', subtitle: 'Overview of your workday and organization updates' },
  '/inbox': { title: 'Inbox', subtitle: 'Review messages, requests, and notifications that need your attention' },
  '/approvals': { title: 'Approvals', subtitle: 'Review WFH, regularisation, leave, and penalisation requests routed to you' },
  '/me/attendance': { title: 'Attendance', subtitle: 'Track your attendance, timings, and attendance requests' },
  '/leave': { title: 'Leave Management', subtitle: 'View your leave balance, requests, and time off' },
  '/attendance/dashboard': { title: 'Dashboard', subtitle: 'Attendance and leave analytics for your team or organisation' },
  '/attendance/settings': { title: 'Settings', subtitle: 'Shifts, leave, calendar, and penalization configuration for the organisation' },
  '/attendance/calendar': { title: 'Calendar', subtitle: 'Your attendance plus organisation holidays, WFH days, and events' },
  '/timesheet': { title: 'Timesheet', subtitle: 'Track logged hours across projects and categories' },
  '/team': { title: 'My Team', subtitle: 'View your team, schedules, and workplace activity' },
  '/employees': { title: 'Organization', subtitle: 'Manage employees and organizational documents' },
  '/manage-org': { title: 'Manage organisation', subtitle: 'Employees, reporting lines and the organisation structure' },
  '/admin': { title: 'Access control', subtitle: 'Manage roles, permissions, people and the activity log' },
  '/org': { title: 'Organisation', subtitle: 'Browse the employee directory and organisation chart' },
  '/settings': { title: 'Settings', subtitle: 'Manage your account preferences' },
  '/help': { title: 'Help & Support', subtitle: 'Find answers to common questions' },
  '/performance': { title: 'Performance', subtitle: 'Track reviews, goals, feedback, and career development' },
  '/payslips': { title: 'My Finances', subtitle: 'View your payslips, salary, taxes, and expenses' },
  '/me': { title: 'Me', subtitle: 'Access your personal information and records' },
  '/engage': { title: 'Engage', subtitle: 'Connect with colleagues and stay updated with your organization' },
  '/calendar': { title: 'Calendar', subtitle: 'Upcoming company events and holidays' },
  '/apps': { title: 'Apps', subtitle: 'Access the tools and applications available to you' },
  '/reports': { title: 'Reports', subtitle: 'Headcount, attendance, leave, and payroll analytics' },
  '/learning': { title: 'Learning', subtitle: 'Courses, certifications, and skill-building resources' },
  '/career': { title: 'Career', subtitle: 'Growth plans, internal mobility, and career conversations' },
};

function getPageTitle(pathname: string) {
  if (pathname === '/') return pageTitles['/'];
  const match = Object.keys(pageTitles)
    .filter((key) => key !== '/' && pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return match ? pageTitles[match] : null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated, hasOrgScope, hasPermission } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Forced temporary-password change (T06): a user with the flag set stays
  // on the change-password screen until the flag clears — nothing else in
  // the app is reachable.
  useEffect(() => {
    if (!isLoading && isAuthenticated && user?.mustChangePassword) {
      router.push('/change-password');
    }
  }, [isAuthenticated, isLoading, user, router]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  // Restore the user's collapse preference, defaulting tablet widths to collapsed.
  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored !== null) {
      setCollapsed(stored === 'true');
    } else if (window.innerWidth >= 768 && window.innerWidth < 1280) {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // Shared access test for a top-level item or a submenu child.
  const canAccess = (rules: {
    roles?: RequiredRole[];
    requireOrgScope?: boolean;
    requirePermission?: string;
    requireAnyPermission?: string[];
  }) =>
    !!user &&
    (!rules.roles || rules.roles.includes(user.role as RequiredRole)) &&
    (!rules.requireOrgScope || hasOrgScope()) &&
    (!rules.requirePermission || hasPermission(rules.requirePermission)) &&
    (!rules.requireAnyPermission || rules.requireAnyPermission.some((code) => hasPermission(code)));

  const filteredNavItems = navItems.filter(canAccess);

  const isActive = (item: NavItem) => {
    if (item.href === '/') return pathname === '/';
    if (pathname.startsWith(item.href)) return true;
    return item.children ? !!getActiveChild(item.children, pathname, searchParams) : false;
  };

  const currentPageTitle = getPageTitle(pathname);

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item);

    return (
      <div key={item.id} className="group/nav relative">
        <Link
          href={item.href}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors relative ${
            collapsed ? 'md:justify-center md:px-0' : ''
          } ${active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
        >
          <span className="relative shrink-0">
            <Icon className="w-5 h-5" />
            {item.badge && collapsed ? (
              <span className="hidden md:flex absolute -top-1.5 -right-1.5 items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold w-4 h-4">
                {item.badge}
              </span>
            ) : null}
          </span>
          <span className={`flex-1 truncate ${collapsed ? 'md:hidden' : ''}`}>{item.label}</span>
          {item.badge ? (
            <span
              className={`${
                collapsed ? 'md:hidden' : ''
              } w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold shrink-0`}
            >
              {item.badge}
            </span>
          ) : null}
        </Link>

        {/* Collapsed-state tooltip */}
        {collapsed ? (
          <span className="hidden md:group-hover/nav:block absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 whitespace-nowrap rounded-md bg-slate-800 text-white text-xs font-medium px-2.5 py-1.5 shadow-lg pointer-events-none">
            {item.label}
          </span>
        ) : null}
      </div>
    );
  };

  // The section owning the current page, if it groups sub-pages - rendered as
  // a secondary tab row under the header instead of a sidebar accordion.
  const activeSection = filteredNavItems.find((item) => item.children?.length && isActive(item));
  const activeSectionChildren = activeSection?.children?.filter(canAccess);

  const sidebarContent = (
    <>
      <div className={`flex items-center gap-3 px-5 pb-4 ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
          H
        </div>
        <span className={`text-white font-bold text-lg tracking-tight truncate ${collapsed ? 'md:hidden' : ''}`}>
          HRMS Portal
        </span>
        <button
          onClick={() => setIsMobileNavOpen(false)}
          className="ml-auto md:hidden text-slate-300 hover:text-white p-1"
          aria-label="Close navigation"
        >
          <XIcon className="w-5 h-5" />
        </button>
        <button
          onClick={toggleCollapsed}
          className={`hidden md:inline-flex ml-auto shrink-0 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg p-1.5 transition-colors ${collapsed ? 'md:hidden' : ''}`}
          aria-label="Collapse navigation"
          title="Collapse navigation"
        >
          <PanelLeftCloseIcon className="w-[18px] h-[18px]" />
        </button>
      </div>

      {collapsed ? (
        <div className="hidden md:flex justify-center pb-4">
          <button
            onClick={toggleCollapsed}
            className="text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg p-1.5 transition-colors"
            aria-label="Expand navigation"
            title="Expand navigation"
          >
            <PanelLeftOpenIcon className="w-[18px] h-[18px]" />
          </button>
        </div>
      ) : null}

      <nav className="flex-1 min-h-0 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        {filteredNavItems.map(renderNavLink)}
      </nav>

      <div className="px-3 pt-3 mt-3 border-t border-slate-800 shrink-0">
        <div className={`flex items-center gap-2 px-2 py-2 ${collapsed ? 'md:justify-center md:px-0' : ''}`}>
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center font-bold text-sm text-white">
              {user?.firstName?.charAt(0) || 'E'}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#0F172A]" />
          </div>
          <div className={`flex-1 min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
            <div className="text-sm font-semibold text-white truncate">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="text-xs text-slate-400 truncate">{roleLabel(user?.role)}</div>
          </div>
          <button
            onClick={() => router.push('/settings')}
            aria-label="Account settings"
            title="Account settings"
            className={`shrink-0 text-slate-400 hover:text-white transition-colors ${collapsed ? 'md:hidden' : ''}`}
          >
            <SettingsIcon className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-[#faf8ff] overflow-hidden">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 bg-white border-b border-slate-200 px-4 py-3">
        <button onClick={() => setIsMobileNavOpen(true)} className="text-slate-700 p-1" aria-label="Open navigation">
          <MenuIcon className="w-6 h-6" />
        </button>
        <span className="text-slate-900 font-bold">HRMS Portal</span>
      </div>

      {/* Mobile drawer overlay */}
      {isMobileNavOpen ? (
        <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setIsMobileNavOpen(false)} />
      ) : null}

      {/* Sidebar */}
      <aside
        className={`w-52 ${
          collapsed ? 'md:w-14' : 'md:w-52'
        } shrink-0 bg-[#0F172A] flex flex-col py-6 fixed md:static inset-y-0 left-0 z-50 transition-[width,transform] duration-200 ease-in-out overflow-hidden ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {sidebarContent}
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden pt-14 md:pt-0 min-w-0">
        {/* Shared top bar, visible on every page */}
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 shrink-0">
          {currentPageTitle ? (
            <div className="min-w-0 shrink-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight truncate">{currentPageTitle.title}</h1>
              {currentPageTitle.subtitle ? (
                <p className="text-xs text-slate-500 truncate hidden sm:block">{currentPageTitle.subtitle}</p>
              ) : null}
            </div>
          ) : null}

          <div className="flex-1 max-w-md">
            <div className="relative">
              <input
                type="text"
                placeholder="Search employees, docs, claims, leaves..."
                className="w-full pl-4 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-slate-300 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hidden sm:flex items-center gap-1">
                <SearchIcon className="w-4 h-4" />
                <kbd className="text-[10px] font-semibold border border-slate-200 rounded px-1 py-0.5">⌘K</kbd>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => router.push('/help')}
              className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              title="Help"
            >
              <HelpIcon className="w-5 h-5" />
            </button>
            <NotificationsDropdown />
            <div className="pl-2 sm:pl-3 border-l border-slate-200">
              <ProfileDropdown />
            </div>
          </div>
        </header>

        {activeSectionChildren?.length ? (
          <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8">
            <div className="flex gap-6 overflow-x-auto">
              {activeSectionChildren.map((child) => {
                const childActive = getActiveChild(activeSectionChildren, pathname, searchParams) === child;
                return (
                  <Link
                    key={child.label}
                    href={child.href}
                    className={`shrink-0 px-1 py-3 border-b-2 font-semibold text-sm transition-colors ${
                      childActive
                        ? 'border-indigo-600 text-indigo-600'
                        : 'border-transparent text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
