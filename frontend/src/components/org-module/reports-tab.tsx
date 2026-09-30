'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

interface ReportRow {
  name: string;
  desc: string;
  /** Set when a real page/export exists in this app; otherwise disabled. */
  href?: string;
  disabledNote?: string;
}

interface Category {
  id: string;
  label: string;
  reports: ReportRow[];
}

const CATEGORIES: Category[] = [
  {
    id: 'employee-info',
    label: 'Employee Info',
    reports: [
      { name: 'Employee directory', desc: 'Live headcount list', href: '/org?tab=directory' },
      { name: 'Organisation chart', desc: 'Live reporting lines', href: '/org?tab=chart' },
      { name: 'All employees', desc: 'Searchable employee grid', href: '/employees' },
      { name: 'Headcount export', desc: 'Downloadable headcount file', disabledNote: 'No export yet' },
      { name: 'Profile changes', desc: 'Edits to employee profiles', disabledNote: 'Not tracked yet' },
    ],
  },
  {
    id: 'policies-others',
    label: 'Employee policies & Others',
    reports: [
      { name: 'Company policies', desc: 'Published policy documents', href: '/policies' },
      { name: 'My documents', desc: 'Files on my own record', href: '/profile?tab=documents' },
      { name: 'Organization documents', desc: 'Shared organisation files', href: '/org?tab=documents' },
      { name: 'Custom fields', desc: 'Employee custom attributes', disabledNote: 'No page yet' },
    ],
  },
  {
    id: 'demography',
    label: 'Employee Demography',
    reports: [
      { name: 'Headcount by department', desc: 'Live department breakdown', href: '/org?tab=directory' },
      { name: 'Headcount by location', desc: 'Live location breakdown', href: '/org?tab=directory' },
      { name: 'Gender breakdown', desc: 'Headcount by gender', disabledNote: 'Not tracked yet' },
      { name: 'Age breakdown', desc: 'Headcount by age band', disabledNote: 'Not tracked yet' },
      { name: 'Tenure breakdown', desc: 'Headcount by years of service', disabledNote: 'Not tracked yet' },
    ],
  },
  {
    id: 'invites',
    label: 'Invites & Registrations',
    reports: [
      { name: 'Pending invites', desc: 'Invitations awaiting acceptance', disabledNote: 'No data source yet' },
      { name: 'Registration status', desc: 'Who has completed sign-up', disabledNote: 'No data source yet' },
    ],
  },
  {
    id: 'joins-exits',
    label: 'New Joins & Exits',
    reports: [
      { name: 'Onboarding pipeline', desc: 'Live hire progress', href: '/onboarding' },
      { name: 'New joiners', desc: 'Recent and upcoming joiners', href: '/onboarding' },
      { name: 'Exits', desc: 'Live resignation states', href: '/exits' },
      { name: 'My exit', desc: 'My own separation record', href: '/me/exit' },
    ],
  },
  {
    id: 'logins',
    label: 'Logins',
    reports: [
      { name: 'Login activity', desc: 'Sign-ins across the organisation', disabledNote: 'No data source yet' },
    ],
  },
  {
    id: 'aggregates',
    label: 'Employee Aggregates',
    reports: [
      { name: 'Headcount summary', desc: 'Totals by department and location', href: '/org?tab=directory' },
      { name: 'Vacancy summary', desc: 'Open positions by department', href: '/org-module/positions' },
      { name: 'Team summary', desc: 'Team rosters and leads', href: '/team' },
    ],
  },
];

function ReportRowView({ row }: { row: ReportRow }) {
  if (row.href) {
    return (
      <Link
        href={row.href}
        className="block px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
      >
        <p className="text-sm font-semibold text-slate-800">{row.name}</p>
        <p className="text-xs text-slate-500 mt-0.5">{row.desc}</p>
      </Link>
    );
  }
  return (
    <span
      title={row.disabledNote}
      aria-disabled="true"
      className="block px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{row.name}</span>
        <span className="text-[11px] shrink-0">{row.disabledNote}</span>
      </span>
      <span className="block text-xs mt-0.5">{row.desc}</span>
    </span>
  );
}

export function ReportsTab() {
  const [category, setCategory] = useState<string>('home');
  const [query, setQuery] = useState('');
  const [customOpen, setCustomOpen] = useState(false);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const out: { category: string; row: ReportRow }[] = [];
    for (const c of CATEGORIES) {
      for (const row of c.reports) {
        if (
          row.name.toLowerCase().includes(q) ||
          row.desc.toLowerCase().includes(q)
        ) {
          out.push({ category: c.label, row });
        }
      }
    }
    return out;
  }, [query]);

  const active = CATEGORIES.find((c) => c.id === category);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
      {/* Categories rail */}
      <nav
        aria-label="Report categories"
        className="bg-white border border-slate-200 rounded-xl p-3 h-fit"
      >
        <p className="px-2 pt-1 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
          Categories
        </p>
        <ul className="mt-1 space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => setCategory('home')}
              aria-current={category === 'home' ? 'true' : undefined}
              className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                category === 'home'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Reports Home
            </button>
          </li>
          {CATEGORIES.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setCategory(c.id)}
                aria-current={category === c.id ? 'true' : undefined}
                className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                  category === c.id
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setCategory('scheduled')}
            aria-current={category === 'scheduled' ? 'true' : undefined}
            className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
              category === 'scheduled'
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Scheduled reports
          </button>
        </div>
      </nav>

      {/* Main */}
      <div className="min-w-0">
        {category === 'home' && (
          <div role="tabpanel" aria-label="Reports Home">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search in all reports"
                  aria-label="Search in all reports"
                  className="w-full px-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setCustomOpen(true)}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Create Custom Report
              </button>
            </div>

            {searchResults !== null ? (
              <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-slate-900">
                  Results ({searchResults.length})
                </h3>
                {searchResults.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No reports match “{query.trim()}”.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {searchResults.map((r, i) => (
                      <div key={`${r.category}-${r.row.name}-${i}`}>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                          {r.category}
                        </p>
                        <ReportRowView row={r.row} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <>
                <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-900">Favourites</h3>
                  <p className="py-8 text-center text-sm text-slate-500">
                    No favourites yet — star a report to pin it here.
                  </p>
                </section>
                <section className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-900">Recently Used</h3>
                  <p className="py-8 text-center text-sm text-slate-500">
                    No recently used reports yet.
                  </p>
                </section>
              </>
            )}
          </div>
        )}

        {category === 'scheduled' && (
          <div role="tabpanel" aria-label="Scheduled reports">
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900">Scheduled reports</h3>
              <p className="py-8 text-center text-sm text-slate-500">
                No scheduled reports yet.
              </p>
            </section>
          </div>
        )}

        {active && (
          <div role="tabpanel" aria-label={active.label}>
            <section className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-sm font-bold text-slate-900">{active.label}</h3>
              <div className="mt-3 space-y-2">
                {active.reports.map((row) => (
                  <ReportRowView key={row.name} row={row} />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Create Custom Report — no report-builder backend; coming soon */}
      {customOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setCustomOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Create Custom Report"
        >
          <div
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-900">Create Custom Report</h3>
            <p className="text-sm text-slate-500 mt-1">
              Custom report builder is coming soon — there is no report backend
              yet, so reports cannot be built or saved.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
